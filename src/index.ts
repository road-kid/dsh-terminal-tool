import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: brings the Loader's `Events` augmentation (`loader/volatile-update`)
// into this compilation unit. Erased at build time.
import type {} from '@deepseek-ai/cordis-plugin-loader'

import { Config, snapshotConfig, wantsBash, type ConfigSnapshot, type RawConfig } from './config.ts'
import { installSession } from './replace.ts'
import { createVariantManager, resolveVariantSpec } from './preset.ts'
import { registerRoutes } from './routes.ts'
import { writeDiagnostic } from './diag.ts'
import type { CapabilityView, Dialect, ReplaceReport } from './shared/protocol.ts'

/**
 * dsh-terminal-tool.
 *
 * Choose `pwsh` or Git Bash per profile, and when bash is selected every new
 * session gets a `bash` tool backed by the real Git Bash, with `pwsh` gone.
 *
 * The plugin owns nothing global. It listens for `agent/created` and installs
 * the replacement into that one agent's scope (see `replace.ts`), so:
 *
 * - existing sessions are untouched (a tool cannot be swapped under a running
 *   agent);
 * - presets need no edits;
 * - `ctx.shell` at profile/host level stays the platform executor.
 *
 * Everything is fail-safe: any problem leaves the session with the stock tool
 * and appends a line to the diagnostic log.
 */

export const name = 'terminal-tool'

/** Resolved lazily through `ctx.get`, so nothing here is a hard dependency. */
export const inject: string[] = []

export { Config }
export type { RawConfig }

/** Last install result per agent, exposed for diagnostics. */
const results = new Map<string, Awaited<ReturnType<typeof installSession>>>()

/** Inspect the outcome of the most recent install attempt for an agent. */
export function installResultFor(agentId: string): Awaited<ReturnType<typeof installSession>> | undefined {
  return results.get(agentId)
}

/** Most recent replacement attempt across all sessions (the settings row shows it). */
let lastReplace: ReplaceReport | undefined

/** Whether a service is visible on a context, without making it a hard dependency. */
function visible(ctx: Context, name: string): boolean {
  try {
    return ctx.get(name) !== undefined
  } catch {
    return false
  }
}

/**
 * Can this deployment switch the terminal tool at all?
 *
 * The replacement itself needs `tools` (to add `bash` and hide `pwsh`) and
 * `systemPrompt` (to drop the pwsh guidance section); those two decide whether
 * `installSession` can succeed, so they decide `supported`. `settings` is not
 * part of that question: without it the mounted session still gets Git Bash, the
 * choice just cannot be persisted from the settings row (the row reports that on
 * its own as `settingsAvailable: false`). Reporting *which* service is missing
 * is what keeps a silent no-op diagnosable.
 */
export function probeCapability(ctx: Context): CapabilityView {
  if (process.platform !== 'win32') return { supported: false, reason: '仅 Windows 支持切换终端工具' }
  if (!visible(ctx, 'tools')) return { supported: false, reason: '当前 DSH 版本不提供 ctx.tools（无法隐藏 pwsh）' }
  if (!visible(ctx, 'systemPrompt')) {
    return { supported: false, reason: '当前 DSH 版本不提供 ctx.systemPrompt（无法压掉 pwsh 提示词）' }
  }
  return { supported: true }
}

export function apply(ctx: Context, config: RawConfig): void {
  // A raw config may arrive unvalidated when the plugin is mounted by hand
  // (tests, other bundles). Validating here means load-time diagnostics are
  // accurate even in that case.
  const initial = snapshotConfig(config)

  if (!wantsBash(initial)) {
    writeDiagnostic('loaded with dialect=pwsh; sessions keep the platform terminal tool')
  }

  // The `minimal-gitbash` variant lives and dies with this fiber: the manager
  // owns the preset definition and drops it on teardown.
  const variant = createVariantManager(ctx)
  const syncVariant = (snapshot: ConfigSnapshot): void => {
    void variant
      .sync(snapshot.minimalMode, () =>
        resolveVariantSpec({
          bashPath: snapshot.bashPath,
          bashCandidates: snapshot.bashCandidates,
          autoDiscover: snapshot.autoDiscover,
          timeoutMs: snapshot.discoverTimeoutMs,
          confinedPolicy: snapshot.confinedPolicy,
          loginShell: snapshot.loginShell,
          pythonUtf8: snapshot.pythonUtf8,
        }),
      )
      .catch((error: unknown) => {
        writeDiagnostic(`variant: sync failed: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  // Deferred through `inject` for two reasons: the preset registry is a sibling
  // host row whose activation order is not ours to assume, and a child fiber
  // keeps the first registration out of this row's own activation.
  ctx.inject(['agentPresets'], () => {
    syncVariant(snapshotConfig(config))
  })
  ctx.effect(() => () => variant.release(), 'terminal-tool: variant')

  // Volatile-only edits do not reload this fiber: the loader commits the new
  // values and emits this event, so this is where a mode change takes effect
  // without restarting the host.
  ctx.on('loader/volatile-update', () => {
    syncVariant(snapshotConfig(config))
  })

  // The settings row reads its state and candidates over `/api`; registering
  // here keeps the read surface next to the writes it describes.
  registerRoutes(ctx, {
    readSnapshot: () => snapshotConfig(config),
    capability: () => probeCapability(ctx),
    settingsAvailable: () => visible(ctx, 'settings'),
    lastReplace: () => lastReplace,
    // `list()` re-audits the preset tree and waits for the Host Loader to
    // settle, so it can only run once this row's activation is over. The
    // handler is therefore a read plus a fire-and-forget refresh: the next
    // `/state` (or the next session) reports the truth.
    variant: () => {
      void variant.verify()
      return variant.state()
    },
  })

  /**
   * `agent/created` is dispatched with `ctx.serial` and awaited before agent
   * creation resolves: a throw here would fail the session. The listener is
   * therefore wrapped so that *nothing* escapes.
   */
  ctx.on('agent/created', async (payload: { agent: Agent }) => {
    const agent = payload.agent
    const id = String(agent.id)
    try {
      // Snapshot per session, not once at load: volatile fields read the
      // *current* profile value, so a settings change applies to the next
      // session even before the loader reloads this fiber (F12).
      const result = await installSession(ctx, agent, snapshotConfig(config))
      results.set(id, result)
      lastReplace =
        result.status === 'installed'
          ? { at: Date.now(), applied: true }
          : { at: Date.now(), applied: false, reason: result.reason }
      if (result.status === 'installed') {
        writeDiagnostic(`installed session=${id} bash=${result.bashPath}`)
      }
    } catch (error) {
      // Defensive: installSession already contains its own failures.
      results.set(id, { status: 'skipped', reason: 'mount-failed' })
      lastReplace = { at: Date.now(), applied: false, reason: 'mount-failed' }
      writeDiagnostic(
        `error session=${id} unexpected ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      )
    }
    // Returning undefined keeps the serial dispatch happy; the type is
    // `undefined | Promise<undefined>`.
    return undefined
  })

  // Sessions end: drop the memo so a long-lived host does not accumulate one
  // entry per conversation.
  ctx.on('agent/disposed', (payload: { agent: Agent }) => {
    results.delete(String(payload.agent.id))
  })
}

/** Exported for the selftest: the dialect a snapshot resolves to. */
export function dialectOf(config: RawConfig): Dialect {
  return snapshotConfig(config).dialect
}
