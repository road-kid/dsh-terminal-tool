import z from '@deepseek-ai/schemastery'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as BashLocalConfig } from '@deepseek-ai/dsh-bash-local'
import type { ConfinedPolicy } from './confined.ts'
import type { MinimalMode } from './shared/protocol.ts'

/**
 * Plugin configuration.
 *
 * Two deliberate composition rules:
 *
 * 1. The official `LocalBashExecutor` config fields are spread in verbatim
 *    (`LocalBashExecutor.Config.dict`), because the executor this plugin mounts
 *    *is* a `LocalBashExecutor` subclass: reusing the published field schemas
 *    keeps timeout/output/grace semantics identical to the first-party bash
 *    executor and means the settings form exposes the same knobs.
 * 2. Every field is `.volatile()`. `@deepseek-ai/dsh-settings` projects only
 *    volatile fields into the settings form, so this is what makes the plugin
 *    configurable from 设置 → 通用 without a bespoke client row.
 *
 * schemastery rejects `.volatile()` on a whole object and on fields nested in a
 * volatile field, so the flag is applied to each leaf individually.
 */
export const Config = z.object({
  ...LocalBashExecutor.Config.dict,

  /**
   * Which terminal tool the session gets. `pwsh` is the default on purpose:
   * installing the plugin must not change behaviour until the user asks for
   * bash (F9).
   */
  dialect: z.union(['pwsh', 'bash'] as const).default('pwsh').volatile(),

  /** Explicit bash executable. Empty means "discover". */
  bashPath: z.string().default('').volatile(),

  /**
   * Extra discovery roots or explicit executables, tried before the built-in
   * order. Accepts either a `bash.exe` or an installation root.
   */
  bashCandidates: z.array(z.string()).default([]).volatile(),

  /** Allow discovery when `bashPath` is empty. */
  autoDiscover: z.boolean().default(true).volatile(),

  /**
   * Upper bound for one discovery sweep. Discovery only stats the filesystem
   * (it never spawns a process), so this is a guard against pathological
   * candidate lists rather than a real timeout.
   */
  discoverTimeoutMs: z.number().default(1500).volatile(),

  /** Pass `-l` so the shell reads the login profile. */
  loginShell: z.boolean().default(false).volatile(),

  /** Directories prepended to the child PATH in addition to the install dirs. */
  extraPath: z.array(z.string()).default([]).volatile(),

  /** Export `PYTHONIOENCODING=utf-8` for the MSYS environment (F14). */
  pythonUtf8: z.boolean().default(true).volatile(),

  /**
   * What to do when a confined Windows sandbox cannot start Git Bash.
   *
   * - `unconfined` (default): launch bash directly, outside the sandbox. Nothing
   *   crashes, but the child is not file-sandboxed.
   * - `escalate`: keep the confined launch. The MSYS startup failure is then
   *   reported as a sandbox denial, which is what makes the first-party bash
   *   tool offer `sandbox_permissions` and lets the model retry with
   *   `danger-full-access` through the official approval flow. The approval
   *   itself belongs to that flow — the plugin never approves anything.
   * - `fail`: report a sandbox error instead of running anything.
   */
  confinedPolicy: z.union(['unconfined', 'escalate', 'fail'] as const).default('unconfined').volatile(),

  /**
   * How the official `minimal` preset is treated.
   *
   * `minimal` is the only shipped preset that runs a *persistent* shell, and on
   * Windows that shell is PowerShell (`dsh-tool-pwsh-persistent`). This plugin
   * only replaces the one-shot `bash` tool, so without this knob minimal
   * sessions silently fall back to a one-shot Git Bash.
   *
   * - `oneshot` (default): pre-0.5 behaviour — minimal gets the one-shot Git Bash.
   * - `leave`: minimal is untouched and keeps its persistent PowerShell.
   * - `variant`: minimal is untouched *and* a `minimal-gitbash` preset variant is
   *   registered so a new session can pick a persistent Git Bash.
   *
   * The default stays `oneshot` so upgrading does not change behaviour; the user
   * opts into the other two from the settings row.
   */
  minimalMode: z.union(['leave', 'oneshot', 'variant'] as const).default('oneshot').volatile(),
})

/** Validated config as cordis hands it to `apply`. */
export type RawConfig = BashLocalConfig & {
  readonly dialect: 'pwsh' | 'bash'
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly discoverTimeoutMs: number
  readonly loginShell: boolean
  readonly extraPath: readonly string[]
  readonly pythonUtf8: boolean
  readonly confinedPolicy: ConfinedPolicy
  readonly minimalMode: MinimalMode
}

/**
 * Immutable view of one session's configuration.
 *
 * Volatile config fields arrive as `{ get() }` references that always read the
 * *current* profile value; taking one snapshot at session creation is what
 * implements F12 ("only new sessions see the new choice") without the plugin
 * ever writing back to the profile.
 */
export interface ConfigSnapshot {
  readonly dialect: 'pwsh' | 'bash'
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly discoverTimeoutMs: number
  readonly loginShell: boolean
  readonly extraPath: readonly string[]
  readonly pythonUtf8: boolean
  readonly confinedPolicy: ConfinedPolicy
  readonly minimalMode: MinimalMode
  readonly cwd: string | undefined
  readonly timeoutMs: number
  readonly maxTimeoutMs: number
  readonly maxOutputBytes: number
  readonly maxSpillBytes: number
  readonly graceMs: number
}

type VolatileLike<T> = { readonly get: () => T }

function isVolatileLike(value: unknown): value is VolatileLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as VolatileLike<unknown>).get === 'function'
}

/**
 * Read a config field that may or may not have been wrapped in a volatile
 * reference.
 *
 * `value` is `unknown` on purpose: the same helper serves fields typed as plain
 * values (an unvalidated hand-built config) and fields typed as `Volatile<T>`
 * (what schemastery produces), and asking every call site to narrow would be
 * noise. The one cast lives here.
 */
function read<T>(value: unknown, fallback: T): T {
  const resolved = isVolatileLike(value) ? value.get() : value
  if (resolved === undefined || resolved === null) return fallback
  return resolved as T
}

function readArray(value: unknown): string[] {
  const resolved = isVolatileLike(value) ? value.get() : value
  if (!Array.isArray(resolved)) return []
  return resolved.map((item) => String(item))
}

/**
 * Read the confined-launch policy, falling back for anything outside the union.
 *
 * The fallback mirrors the schema default: a malformed profile value must keep
 * Git Bash usable rather than leave the session without a terminal tool.
 */
function readMinimalMode(value: unknown): MinimalMode {
  const resolved = read<string>(value, 'oneshot')
  if (resolved === 'leave' || resolved === 'variant') return resolved
  return 'oneshot'
}

function readConfinedPolicy(value: unknown): ConfinedPolicy {
  const resolved = read<string>(value, 'unconfined')
  if (resolved === 'escalate' || resolved === 'fail') return resolved
  return 'unconfined'
}

/**
 * Defaults mirrored from the schemastery schema; used only for unvalidated input.
 */
const DEFAULTS = {
  timeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  maxOutputBytes: 64_000,
  maxSpillBytes: 64 * 1024 * 1024,
  graceMs: 3_000,
} as const

/**
 * Take one immutable snapshot of the plugin config.
 *
 * Cordis runs the config through the schemastery schema before `apply`, so all
 * fields are present and already resolved. The fallbacks below only matter when
 * a harness (or the selftest) passes a hand-built config that skipped
 * validation: the snapshot must still be total, because a throw here would
 * interrupt `agent/created`.
 */
export function snapshotConfig(config: RawConfig): ConfigSnapshot {
  // The declared type says volatile fields are `Volatile<T>` references, but the
  // same function also accepts a hand-built config that skipped validation, where
  // they are plain values. Reading through an index signature is the single place
  // that dual nature is asserted; `read` re-establishes the real type per field.
  const source = config as unknown as Readonly<Record<string, unknown>>
  const dialect = read<string>(source.dialect, 'pwsh')
  return Object.freeze({
    dialect: dialect === 'bash' ? 'bash' : 'pwsh',
    bashPath: read<string>(source.bashPath, '').trim(),
    bashCandidates: readArray(source.bashCandidates),
    autoDiscover: read<boolean>(source.autoDiscover, true) !== false,
    discoverTimeoutMs: Math.max(0, Number(read<number>(source.discoverTimeoutMs, 1500)) || 0),
    loginShell: read<boolean>(source.loginShell, false) === true,
    extraPath: readArray(source.extraPath),
    pythonUtf8: read<boolean>(source.pythonUtf8, true) !== false,
    confinedPolicy: readConfinedPolicy(source.confinedPolicy),
    minimalMode: readMinimalMode(source.minimalMode),
    cwd: read<string>(source.cwd, '') || undefined,
    timeoutMs: read<number>(source.timeoutMs, DEFAULTS.timeoutMs),
    maxTimeoutMs: read<number>(source.maxTimeoutMs, DEFAULTS.maxTimeoutMs),
    maxOutputBytes: read<number>(source.maxOutputBytes, DEFAULTS.maxOutputBytes),
    maxSpillBytes: read<number>(source.maxSpillBytes, DEFAULTS.maxSpillBytes),
    graceMs: read<number>(source.graceMs, DEFAULTS.graceMs),
  })
}

/**
 * Plain values handed to the mounted executor.
 *
 * These are *inputs*, not the validated executor config: `ctx.plugin()` runs
 * them through the executor's schemastery schema, which is what turns volatile
 * fields into `{ get() }` references. Passing the references back in would
 * attempt to freeze a function and fail validation.
 */
export interface ExecutorArgs {
  readonly confinedPolicy: ConfinedPolicy
  readonly cwd?: string
  readonly timeoutMs: number
  readonly maxTimeoutMs: number
  readonly maxOutputBytes: number
  readonly maxSpillBytes: number
  readonly graceMs: number
}

/** Config fields the mounted executor inherits from this plugin's config. */
export function executorConfig(snapshot: ConfigSnapshot): ExecutorArgs {
  return {
    confinedPolicy: snapshot.confinedPolicy,
    cwd: snapshot.cwd,
    timeoutMs: snapshot.timeoutMs,
    maxTimeoutMs: snapshot.maxTimeoutMs,
    maxOutputBytes: snapshot.maxOutputBytes,
    maxSpillBytes: snapshot.maxSpillBytes,
    graceMs: snapshot.graceMs,
  }
}

/** Whether the config selects bash at all. */
export function wantsBash(snapshot: ConfigSnapshot): boolean {
  return snapshot.dialect === 'bash'
}
