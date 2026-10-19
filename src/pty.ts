import z from '@deepseek-ai/schemastery'
import { SandboxUnavailableError, type SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { BashTerminalBackend } from '@deepseek-ai/dsh-terminal-bash'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'

import { planLaunch, type ConfinedPolicy } from './confined.ts'
import { writeDiagnostic } from './diag.ts'

/**
 * Persistent Git Bash backend (`dsh-terminal-tool/pty`).
 *
 * This module is mounted *inside* a preset's `persistent-shell` group
 * (`isolate: { terminals: true }`), never by the root plugin: it imports
 * `@deepseek-ai/dsh-terminal-bash`, which only exists in deployments that ship
 * the persistent-terminal stack. Keeping it a separate entry point is what lets
 * the root plugin load on machines without that stack.
 *
 * The implementation is deliberately thin. `BashTerminalBackend` already owns
 * the sandbox-mode fence, the PTY state machine, the prompt handshake and the
 * `DSH_*` environment; the only thing it cannot express on Windows is "Git Bash
 * cannot start inside a restricted sandbox". We therefore reuse the whole class
 * and inject its third constructor argument (`spawnTerminal`), which runs after
 * `spawnArgv` decided whether to wrap the command in the sandbox runner:
 *
 * - `planLaunch(...) === 'direct'` -> hand node-pty the original
 *   `[bashPath, ...shellArgs]`, dropping the confined wrapper;
 * - `'confine'` -> pass the spec through unchanged, keeping official behaviour;
 * - `'fail'` -> throw `SandboxUnavailableError`, the same error class the
 *   first-party bash tool uses for "cannot run under this sandbox".
 */

/** Backend type the preset rows point at (`config.backendType`). */
const DEFAULT_BACKEND_TYPE = 'gitbash'

export const name = 'terminal-tool-pty'

/** Mirrors the official backend's dependencies plus the registry we add to. */
export const inject = ['terminals', 'subprocess', 'sandboxPolicy']

export const Config = z.object({
  /** Type this backend registers under; preset rows must use the same value. */
  backendType: z.string().default(DEFAULT_BACKEND_TYPE),
  /** Absolute path of the Git Bash executable. Required at runtime. */
  bashPath: z.string().default(''),
  /** Arguments passed to bash; mirrors the official one-shot defaults. */
  shellArgs: z.array(z.string()).default(['--noprofile', '--norc', '-i']),
  /** Export `PYTHONIOENCODING=utf-8` for the MSYS environment. */
  pythonUtf8: z.boolean().default(true),
  /** Read the login profile (`-l`), matching the one-shot executor's flag. */
  loginShell: z.boolean().default(false),
  /** Same three-value policy the one-shot executor uses. */
  confinedPolicy: z.union(['unconfined', 'escalate', 'fail'] as const).default('unconfined'),
})

export type PtyConfig = {
  readonly backendType: string
  readonly bashPath: string
  readonly shellArgs: readonly string[]
  readonly loginShell: boolean
  readonly pythonUtf8: boolean
  readonly confinedPolicy: ConfinedPolicy
}

/**
 * Defaults mirrored from `@deepseek-ai/dsh-terminal-bash`.
 *
 * That package resolves its own defaults inside its `apply`, which cannot be
 * reused here (we construct the backend directly), so this module keeps a full
 * resolved config instead of relying on optional fields.
 */
const TERMINAL_DEFAULTS = {
  rows: 40,
  cols: 160,
  scrollbackLines: 10_000,
  scrollbackMaxBytes: 4 * 1024 * 1024,
  maxReadBytes: 256 * 1024,
  pollIntervalMs: 50,
  exactProbeAfterMs: 150,
  idleSilenceMs: 3_000,
  handoffGraceMs: 500,
  promptTailGraceMs: 0,
  timeoutMs: 30_000,
  disposeGraceMs: 3_000,
} as const

function resolveBackendConfig(config: PtyConfig): ResolvedBackendConfig {
  const shellPath = config.bashPath.trim()
  if (shellPath === '') throw new Error('terminal-tool/pty: bashPath must be non-empty')
  const backendType = config.backendType.trim()
  if (backendType === '') throw new Error('terminal-tool/pty: backendType must be non-empty')
  return {
    ...TERMINAL_DEFAULTS,
    backendType,
    shellDialect: 'bash',
    shellPath,
    // A login shell is the one argument this backend adds on top of the official
    // defaults: `--noprofile --norc` would otherwise defeat `-l`.
    shellArgs: config.loginShell ? ['-l', ...(config.shellArgs ?? [])] : [...(config.shellArgs ?? [])],
  }
}

/**
 * Fully resolved backend config.
 *
 * The official `ResolvedConfig` type is not exported from the package root (and
 * `./src/*` is not shipped in the published tarball), so the shape is restated
 * here; it is the structural contract `BashTerminalBackend`'s constructor
 * accepts.
 */
interface ResolvedBackendConfig {
  readonly backendType: string
  readonly shellDialect: 'bash'
  readonly shellPath: string
  readonly shellArgs: string[]
  readonly rows: number
  readonly cols: number
  readonly scrollbackLines: number
  readonly scrollbackMaxBytes: number
  readonly maxReadBytes: number
  readonly pollIntervalMs: number
  readonly exactProbeAfterMs: number
  readonly idleSilenceMs: number
  readonly handoffGraceMs: number
  readonly promptTailGraceMs: number
  readonly timeoutMs: number
  readonly disposeGraceMs: number
}

/** The `sandboxPolicy` surface the launch decision needs. */
interface SandboxPolicyLike {
  readonly defaultMode?: SandboxMode
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function apply(ctx: Context, config: PtyConfig): Promise<void> {
  const resolved = resolveBackendConfig(config)
  const policy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  const choice = config.confinedPolicy

  try {
    const backend = new BashTerminalBackend(ctx, resolved, async (spec: SubprocessTerminalSpawnSpec) => {
      const plan = planLaunch({
        hasSandbox: policy !== undefined,
        policyMode: policy?.defaultMode,
        choice,
        platform: process.platform,
      })
      if (plan.kind === 'fail') {
        const mode = policy?.defaultMode
        throw new SandboxUnavailableError(mode === 'read-only' ? 'read-only' : 'workspace-write', plan.reason)
      }
      if (plan.kind === 'confine') return ctx.subprocess.spawnTerminal(spec)
      // `direct`: drop the confined wrapper and launch Git Bash directly, exactly
      // like the one-shot executor's direct branch.
      const env = config.pythonUtf8 ? { ...spec.env, PYTHONIOENCODING: 'utf-8' } : spec.env
      return ctx.subprocess.spawnTerminal({
        ...spec,
        argv: [resolved.shellPath, ...resolved.shellArgs],
        env,
      })
    })
    ctx.terminals.registerBackend(backend)
    writeDiagnostic(`pty: registered backend=${resolved.backendType} bash=${resolved.shellPath} policy=${choice}`)
  } catch (error) {
    // A preset row must not take the whole composition down: report and stop.
    writeDiagnostic(`pty: backend registration failed: ${messageOf(error)}`)
  }
}

export { DEFAULT_BACKEND_TYPE }
