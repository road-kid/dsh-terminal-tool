import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { ShellExecRequest } from '@deepseek-ai/dsh-shell'

import { note, skip, warn, type SkipReason } from './diag.ts'
import { executorConfig, type ConfigSnapshot } from './config.ts'
import { GitBashExecutor } from './executor.ts'
import { bashInstallRoot, bashPathEntries } from './paths.ts'
import { discoverBash } from './discover.ts'

/**
 * Per-session replacement.
 *
 * The plugin never takes over `ctx.shell` globally and never edits preset
 * files. Instead, when a session is announced it builds a private isolate
 * subtree for that one agent, mounts the bash executor and the stock
 * `tool-bash` inside it, and then hides `pwsh` from that agent's view:
 *
 * - the shell executor lives behind `isolate('shell', ...)`, so only plugins
 *   mounted on that subtree can see it — every other agent, and the host
 *   itself, keeps the platform's executor;
 * - `tool-bash` registers `bash` through the subtree context, which carries the
 *   agent's scope tag, so the tool lands in the agent's own tool layer;
 * - `restrict({ deny: ['pwsh'] })` only filters what the agent *inherits*, so
 *   it removes the preset's `pwsh` tool while leaving every other preset tool
 *   untouched;
 * - a same-named prompt section with empty text removes the `pwsh` guidance
 *   section (empty sections are dropped at render time).
 *
 * Every step is idempotent and every failure is contained: a session that
 * cannot be replaced keeps the stock pwsh tool and records why.
 */

/** Marker in the diagnostic log and the isolate label. */
const TAG = 'terminal-tool'

/** Fallback order for the `tool:pwsh` prompt section when the table lookup fails. */
const TOOL_PWSH_ORDER = 1010

/** What a session-level attempt produced, for tests and diagnostics. */
export type InstallResult =
  | { readonly status: 'installed'; readonly bashPath: string }
  | { readonly status: 'skipped'; readonly reason: SkipReason; readonly detail?: string }

/**
 * Services are probed rather than injected: this plugin is loaded at profile
 * root, and a composition that lacks one of them must degrade to "leave the
 * session alone" instead of failing to load.
 */
function optional<T>(ctx: Context, name: string): T | undefined {
  return ctx.get(name) as T | undefined
}

/**
 * Replace one session's terminal tool.
 *
 * Runs inside `agent/created`, which is dispatched serially: a throw here fails
 * agent creation, so the whole body is defensive and always resolves.
 */
export async function installSession(
  ctx: Context,
  agent: Agent,
  snapshot: ConfigSnapshot,
): Promise<InstallResult> {
  const id = String(agent.id)

  if (process.platform !== 'win32') return { status: 'skipped', reason: skip(id, 'not-win32') }
  if (snapshot.dialect !== 'bash') return { status: 'skipped', reason: skip(id, 'dialect-pwsh') }

  const agentCtx = agent.ctx
  if (agentCtx === undefined) return { status: 'skipped', reason: skip(id, 'no-agent-context') }

  const tools = optional<ToolRuntime>(agentCtx, 'tools')
  const systemPrompt = optional<SystemPrompt>(agentCtx, 'systemPrompt')
  if (tools === undefined) return { status: 'skipped', reason: skip(id, 'missing-service', 'tools') }
  if (systemPrompt === undefined) {
    return { status: 'skipped', reason: skip(id, 'missing-service', 'systemPrompt') }
  }

  // Idempotency: if a `bash` tool already exists in this agent's view — a retry,
  // a custom preset that ships one, or a previous install that survived — do
  // nothing. Registering a second one would throw inside the tool layer.
  if (tools.get('bash', agent) !== undefined) {
    return { status: 'skipped', reason: skip(id, 'already-replaced') }
  }

  // Resolve bash before touching the tree so a missing installation has no
  // side effects at all.
  const discovery = await discoverBash({
    bashPath: snapshot.bashPath,
    bashCandidates: snapshot.bashCandidates,
    autoDiscover: snapshot.autoDiscover,
    timeoutMs: snapshot.discoverTimeoutMs,
  })
  const found = discovery.found
  if (found === undefined) {
    const detail =
      discovery.rejected.length === 0
        ? `no candidate found (${discovery.considered.length} considered)`
        : discovery.rejected.map((item) => `${item.path}: ${item.reason}`).join('; ')
    return { status: 'skipped', reason: skip(id, 'bash-not-found', detail) }
  }

  const installRoot = bashInstallRoot(found.path)
  const pathEntries = bashPathEntries(installRoot, snapshot.extraPath)

  // Everything created below is registered on `agentCtx`, so cordis unwinds it
  // when the agent is disposed. The explicit list exists only to roll back a
  // *partial* install inside this function.
  const undo: (() => void)[] = []
  const fibers: { dispose: () => Promise<void> }[] = []

  try {
    // The private shell realm for this agent. Without a label every call
    // creates a fresh isolate symbol, which is exactly the intended privacy:
    // this executor is visible only to plugins mounted on `shellCtx`.
    const shellCtx = agentCtx.isolate('shell')

    const executorHost = await shellCtx.plugin(GitBashExecutor, {
      ...executorConfig(snapshot),
      bashPath: found.path,
      pathEntries,
      loginShell: snapshot.loginShell,
      pythonUtf8: snapshot.pythonUtf8,
    })
    fibers.push(executorHost)

    const toolHost = await shellCtx.plugin(ToolBash, {
      enableRunInBackground: true,
      promoteOnTimeout: true,
    })
    fibers.push(toolHost)

    // Verify the mount produced the tool before hiding pwsh: if `bash` never
    // appeared, restricting `pwsh` would leave the agent with no terminal tool.
    // Throwing here routes into the same reverse rollback as any other failure —
    // returning early would leave the mounted subtree alive for the rest of the
    // session while the session itself stayed on pwsh.
    if (tools.get('bash', agent) === undefined) {
      throw new Error('tool-bash mounted but did not register a bash tool')
    }

    // Hide the platform tool. `restrict()` validates names against the tools the
    // agent inherits, so a composition without `pwsh` must skip rather than throw.
    if (tools.get('pwsh', agent) !== undefined) {
      undo.push(tools.restrict({ deny: ['pwsh'] }))
      undo.push(
        systemPrompt.section({
          name: 'tool:pwsh',
          order: systemPrompt.getSectionOrder('TOOL_PWSH') ?? TOOL_PWSH_ORDER,
          text: '',
        }),
      )
    } else {
      warn(id, 'no inherited pwsh tool to hide; leaving the inherited tool list alone')
    }

    // Hand the disposers to the agent's fiber so they run in reverse order when
    // the session ends.
    agentCtx.effect(() => () => {
      for (const disposer of undo.reverse()) {
        try {
          disposer()
        } catch {
          // Disposal is best-effort; the fiber tree is the real safety net.
        }
      }
    })

    note(id, `bash=${found.path} source=${found.source} path=${pathEntries.length} entries`)
    return { status: 'installed', bashPath: found.path }
  } catch (error) {
    // Reverse rollback: newest first, so a half-mounted subtree is unwound in
    // the order cordis itself would use.
    for (const disposer of undo.reverse()) {
      try {
        disposer()
      } catch {
        // ignore
      }
    }
    for (const fiber of fibers.reverse()) {
      try {
        await fiber.dispose()
      } catch {
        // ignore
      }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 'skipped', reason: skip(id, 'mount-failed', detail) }
  }
}

/** Re-exported so the selftest can build a request without importing the shell package. */
export type { ShellExecRequest }
