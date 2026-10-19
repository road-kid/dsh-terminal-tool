import { JSON_SCHEMA, Type, dump, load } from 'js-yaml'
import type { Context } from '@deepseek-ai/cordis'

import type { MinimalMode, VariantStatus, VariantView } from './shared/protocol.ts'
import { discoverBash } from './discover.ts'
import { writeDiagnostic } from './diag.ts'

/**
 * The `minimal-gitbash` preset variant.
 *
 * `minimal` is the only shipped preset that runs a *persistent* shell, and on
 * Windows that shell is PowerShell. A one-shot replacement cannot fix that, so
 * the only way to get a persistent Git Bash is a second preset that swaps the
 * backend. Rather than hard-coding a copy of the official preset (which would
 * silently drift when the shipped one changes), the variant is derived at
 * runtime from `agentPresets.readDocument('minimal')`.
 *
 * Everything here is fail-safe: a registration problem lands in the settings row
 * as `failed` and never throws into `agent/created` or a route handler.
 */

/** Preset id of the variant. Must differ from the official `minimal`. */
export const VARIANT_ID = 'minimal-gitbash'

/** The official preset the variant is derived from. */
/** Shipped preset the variant is cloned from. */
export const MINIMAL_ID = 'minimal'

const SOURCE_ID = MINIMAL_ID

/** Backend type registered by `lib/pty.js`. */
const BACKEND_TYPE = 'gitbash'

/** Row id/plugin name of the persistent Git Bash backend. */
const PTY_ROW_ID = 'gitbash-pty'
const PTY_ROW_NAME = 'dsh-terminal-tool/pty'

/**
 * `!!js` tag, copied verbatim from `@deepseek-ai/cordis-plugin-include`
 * (`tag:yaml.org,2002:js`).
 *
 * `predicate` is not optional: without it `dump` writes the plain mapping
 * `{ __jsExpr: … }` instead of the tag, which silently produces rows the loader
 * will not evaluate as expressions.
 */
const JsExpr = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (value) => value instanceof Object && '__jsExpr' in value,
  represent: (data) => String((data as { __jsExpr: unknown }).__jsExpr),
})

/** The loader's YAML dialect: JSON schema plus the `!!js` tag. */
const entryListSchema = JSON_SCHEMA.extend(JsExpr)

/** One plugin row of a preset composition (loosely typed on purpose). */
type EntryRow = Record<string, unknown>

/** Inputs the variant rows are built from. */
export interface VariantSpec {
  /** Absolute path of the Git Bash the persistent backend must launch. */
  readonly bashPath: string
  readonly confinedPolicy: 'unconfined' | 'escalate' | 'fail'
  readonly loginShell: boolean
  readonly pythonUtf8: boolean
}

/** Display text of the variant in the preset picker. */
const VARIANT_NAME = '极简模式 · Git Bash'
const VARIANT_DESCRIPTION = 'minimal 预设的持久 Git Bash 版本：一个 bash 工具，跨调用保持状态。'

/**
 * Derive the variant's plugin rows from the official `minimal` rows.
 *
 * Pure: `rows` is deep-cloned before editing, so the registry's cached
 * definition is never mutated.
 *
 * The transformation is deliberately minimal — replacement, not invention:
 *
 * 1. drop `terminal-pwsh` / `persistent-pwsh` (the persistent PowerShell pair);
 * 2. re-enable `persistent-bash` (it ships disabled on win32) and point it at
 *    our backend type;
 * 3. insert our persistent Git Bash backend right after `pty`.
 *
 * Throws when the official composition no longer has the expected shape; the
 * caller reports that as a failed variant instead of guessing.
 */
export function cloneMinimalForGitBash(rows: readonly EntryRow[], spec: VariantSpec): EntryRow[] {
  const variant = structuredClone(rows) as EntryRow[]
  const shell = variant.find((row) => row['id'] === 'persistent-shell')
  if (shell === undefined) throw new Error('minimal preset has no persistent-shell group')
  if (!Array.isArray(shell['config'])) throw new Error('persistent-shell has no row list')

  const inner = shell['config'] as EntryRow[]
  shell['config'] = inner.filter((row) => row['id'] !== 'terminal-pwsh' && row['id'] !== 'persistent-pwsh')

  const bash = (shell['config'] as EntryRow[]).find((row) => row['id'] === 'persistent-bash')
  if (bash === undefined) throw new Error('minimal preset has no persistent-bash tool')
  delete bash['disabled']
  bash['config'] = { ...(bash['config'] as Record<string, unknown> | undefined), backendType: BACKEND_TYPE }

  const anchor = (shell['config'] as EntryRow[]).findIndex((row) => row['id'] === 'pty')
  if (anchor < 0) throw new Error('minimal preset has no pty row')
  ;(shell['config'] as EntryRow[]).splice(anchor + 1, 0, {
    id: PTY_ROW_ID,
    name: PTY_ROW_NAME,
    config: {
      backendType: BACKEND_TYPE,
      bashPath: spec.bashPath,
      confinedPolicy: spec.confinedPolicy,
      loginShell: spec.loginShell,
      pythonUtf8: spec.pythonUtf8,
    },
  })

  return variant
}

/** Parse the YAML document `readDocument` returns (a bare plugin-row list). */
export function parsePresetRows(yamlText: string): EntryRow[] {
  const parsed = load(yamlText, { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error('preset document is not a row list')
  return parsed as EntryRow[]
}

/** Serialize rows back to YAML — only used by the tests, kept next to the parser. */
export function formatPresetRows(rows: readonly EntryRow[]): string {
  return dump(rows, { schema: entryListSchema, noRefs: true, lineWidth: -1 })
}

/** Minimal view of the `agentPresets` service this module needs. */
interface AgentPresets {
  register(definition: {
    readonly id: string
    readonly name?: string
    readonly description?: string
    readonly order?: number
    readonly plugins: readonly EntryRow[]
  }): Promise<() => Promise<void>>
  list(): Promise<readonly { readonly id: string; readonly broken?: string }[]>
  readDocument(id: string): Promise<{ readonly content: string }>
}

interface SessionLike {
  readonly id?: unknown
  readonly header?: { readonly agentPreset?: string }
}

/** State machine value the settings row renders. */
interface ManagerState {
  status: VariantStatus
  refs: number
  reason?: string
}

/** The variant manager, as used by `index.ts` and the tests. */
export interface VariantManager {
  /** Current state (synchronously readable; updated by every operation). */
  state(): VariantView
  /**
   * Converge on the requested mode. Idempotent and coalescing: concurrent
   * calls share one in-flight pass.
   */
  sync(mode: MinimalMode, spec: () => Promise<VariantSpec | undefined>): Promise<VariantView>
  /**
   * Check the roster for a failed mount.
   *
   * Kept separate from {@link sync} on purpose: `list()` re-audits the preset
   * tree and, while a row is still pending, awaits the Host Loader tree to
   * settle — which would deadlock if called from inside this plugin's own
   * activation. Callers must run it after activation returns.
   */
  verify(): Promise<VariantView>
  /** Drop the definition unconditionally (plugin teardown). */
  release(): Promise<void>
}

/** Services the manager reads, resolved lazily so nothing is a hard dependency. */
function service<T>(ctx: Context, name: string): T | undefined {
  try {
    return ctx.get(name) as T | undefined
  } catch {
    return undefined
  }
}

/**
 * Sessions that still resolve the variant preset.
 *
 * `live` reads the session projection (not the header): switching presets during
 * a blank turn only appends `agent-preset/selected` and never rewrites the
 * immutable creation header. `persisted` scans `sessionQuery` headers, which is
 * cheap but blind to exactly those switched sessions — the deliberate tradeoff
 * documented in `docs/PLAN-minimal-mode.md`.
 */
function countReferences(ctx: Context): number {
  let live = 0
  const sessions = service<{ list(): readonly SessionLike[] }>(ctx, 'sessions')
  if (sessions !== undefined) {
    const projections = service<{ stateOf(session: SessionLike, key: string): unknown }>(ctx, 'sessionProjections')
    for (const session of sessions.list()) {
      const projected = projections?.stateOf(session, 'agentPreset')
      const preset = typeof projected === 'string' ? projected : session.header?.agentPreset
      if (preset === VARIANT_ID) live += 1
    }
  }
  return live
}

async function countPersistedReferences(ctx: Context): Promise<number> {
  const query = service<{ listSessions(): Promise<readonly { readonly header?: { readonly agentPreset?: string } }[]> }>(
    ctx,
    'sessionQuery',
  )
  if (query === undefined) return 0
  try {
    const records = await query.listSessions()
    return records.filter((record) => record.header?.agentPreset === VARIANT_ID).length
  } catch (error) {
    writeDiagnostic(`variant: sessionQuery scan failed: ${messageOf(error)}`)
    return 0
  }
}

/** Identity of the inputs baked into a definition; a change forces a rebuild. */
function specSignature(spec: VariantSpec): string {
  return [spec.bashPath, spec.confinedPolicy, spec.loginShell ? 'login' : 'plain', spec.pythonUtf8 ? 'utf8' : 'raw'].join('|')
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Create the variant manager for one plugin instance. */
export function createVariantManager(ctx: Context): VariantManager {
  let current: ManagerState = { status: 'absent', refs: 0 }
  let definition: { readonly id: string; readonly plugins: readonly EntryRow[] } | undefined
  let unregister: (() => Promise<void>) | undefined
  /** Signature of the inputs embedded in the live definition. */
  let signature: string | undefined
  let inflight: Promise<VariantView> | undefined
  let disposed = false

  const view = (): VariantView => ({
    status: current.status,
    id: VARIANT_ID,
    refs: current.refs,
    ...(current.reason === undefined ? {} : { reason: current.reason }),
  })

  const set = (next: ManagerState): VariantView => {
    current = next
    return view()
  }

  function presets(): AgentPresets | undefined {
    return service<AgentPresets>(ctx, 'agentPresets')
  }

  async function references(): Promise<number> {
    return countReferences(ctx) + (await countPersistedReferences(ctx))
  }

  async function register(spec: VariantSpec): Promise<VariantView> {
    const presetsService = presets()
    if (presetsService === undefined) {
      return set({ status: 'failed', refs: 0, reason: 'agentPresets service is not available' })
    }
    try {
      const document = await presetsService.readDocument(SOURCE_ID)
      const rows = cloneMinimalForGitBash(parsePresetRows(document.content), spec)
      definition = { id: VARIANT_ID, plugins: rows }
      unregister = await presetsService.register({
        id: VARIANT_ID,
        name: VARIANT_NAME,
        description: VARIANT_DESCRIPTION,
        order: 3.1,
        plugins: rows,
      })
      // `register` never rejects for a broken mount: the failure is recorded on
      // the definition instead, so the only honest check is the roster — which
      // must wait until activation is over (see `verify`).
      writeDiagnostic(`variant: registered ${VARIANT_ID} bash=${spec.bashPath}`)
      return set({ status: 'registered', refs: 0 })
    } catch (error) {
      const reason = messageOf(error)
      writeDiagnostic(`variant: registration failed: ${reason}`)
      unregister = undefined
      definition = undefined
      return set({ status: 'failed', refs: 0, reason })
    }
  }

  async function unregisterVariant(): Promise<void> {
    const drop = unregister
    unregister = undefined
    definition = undefined
    signature = undefined
    if (drop === undefined) return
    try {
      await drop()
      writeDiagnostic(`variant: unregistered ${VARIANT_ID}`)
    } catch (error) {
      writeDiagnostic(`variant: unregister failed: ${messageOf(error)}`)
    }
  }

  async function converge(mode: MinimalMode, spec: () => Promise<VariantSpec | undefined>): Promise<VariantView> {
    const wanted = mode === 'variant'
    const refs = await references()

    if (!wanted) {
      if (definition === undefined) return set({ status: 'absent', refs })
      if (refs > 0) {
        // Dropping the definition would make these sessions unopenable, and the
        // official resume path has no fallback. Keep it and say why.
        return set({ status: 'retained', refs })
      }
      await unregisterVariant()
      return set({ status: 'absent', refs: 0 })
    }

    const resolved = await spec()
    if (resolved === undefined) {
      // A registered variant whose Git Bash disappeared stays as it is: it was
      // built from a working path, and re-resolving on every sync must not
      // destroy a usable definition.
      if (definition !== undefined) return set({ status: 'registered', refs })
      return set({ status: 'failed', refs: 0, reason: 'Git Bash was not found' })
    }

    if (definition !== undefined) {
      if (signature === specSignature(resolved)) {
        const registered = unregister !== undefined
        return set({ status: registered ? 'registered' : 'failed', refs })
      }
      // The embedded inputs changed (a new Git Bash path, policy or login
      // mode). The rows carry them verbatim, so the definition must be rebuilt;
      // sessions already bound to the old revision keep running on it.
      writeDiagnostic('variant: inputs changed; rebuilding the definition')
      await unregisterVariant()
    }

    signature = specSignature(resolved)
    return register(resolved)
  }

  return {
    state: view,
    async verify() {
      if (definition === undefined) return view()
      const presetsService = presets()
      if (presetsService === undefined) return view()
      try {
        const roster = await presetsService.list()
        const entry = roster.find((row) => row.id === VARIANT_ID)
        if (entry?.broken !== undefined) {
          writeDiagnostic(`variant: mount failed: ${entry.broken}`)
          return set({ status: 'failed', refs: current.refs, reason: entry.broken })
        }
      } catch (error) {
        writeDiagnostic(`variant: roster check failed: ${messageOf(error)}`)
      }
      return view()
    },
    async sync(mode, spec) {
      if (disposed) return view()
      if (inflight !== undefined) {
        await inflight.catch(() => undefined)
        if (disposed) return view()
      }
      const pass = converge(mode, spec).catch((error) => {
        writeDiagnostic(`variant: sync failed: ${messageOf(error)}`)
        return set({ status: 'failed', refs: current.refs, reason: messageOf(error) })
      })
      inflight = pass
      try {
        return await pass
      } finally {
        if (inflight === pass) inflight = undefined
      }
    },
    async release() {
      disposed = true
      if (inflight !== undefined) await inflight.catch(() => undefined)
      await unregisterVariant()
      signature = undefined
      current = { status: 'absent', refs: 0 }
    },
  }
}

/**
 * Resolve the concrete inputs for one variant registration.
 *
 * Discovery runs here rather than being copied from the settings snapshot: the
 * variant rows embed an absolute `bashPath`, and registering with a stale one is
 * worse than failing loudly.
 */
export async function resolveVariantSpec(options: {
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly timeoutMs: number
  readonly confinedPolicy: 'unconfined' | 'escalate' | 'fail'
  readonly loginShell: boolean
  readonly pythonUtf8: boolean
}): Promise<VariantSpec | undefined> {
  if (options.bashPath.trim() !== '') {
    return {
      bashPath: options.bashPath.trim(),
      confinedPolicy: options.confinedPolicy,
      loginShell: options.loginShell,
      pythonUtf8: options.pythonUtf8,
    }
  }
  const report = await discoverBash({
    bashPath: options.bashPath,
    bashCandidates: options.bashCandidates,
    autoDiscover: options.autoDiscover,
    timeoutMs: options.timeoutMs,
  })
  if (report.found === undefined) return undefined
  return {
    bashPath: report.found.path,
    confinedPolicy: options.confinedPolicy,
    loginShell: options.loginShell,
    pythonUtf8: options.pythonUtf8,
  }
}
