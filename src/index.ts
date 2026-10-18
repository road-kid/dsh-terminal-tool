import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

import { Config, snapshotConfig, wantsBash, type RawConfig } from './config.ts'
import { installSession } from './replace.ts'
import { writeDiagnostic } from './diag.ts'

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

export function apply(ctx: Context, config: RawConfig): void {
  // A raw config may arrive unvalidated when the plugin is mounted by hand
  // (tests, other bundles). Validating here means load-time diagnostics are
  // accurate even in that case.
  const initial = snapshotConfig(config)

  if (!wantsBash(initial)) {
    writeDiagnostic('loaded with dialect=pwsh; sessions keep the platform terminal tool')
  }

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
    } catch (error) {
      // Defensive: installSession already contains its own failures.
      results.set(id, { status: 'skipped', reason: 'mount-failed' })
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
