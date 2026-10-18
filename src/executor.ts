import type { Context } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as BashLocalConfig } from '@deepseek-ai/dsh-bash-local'
import {
  SandboxUnavailableError,
  classifyRunnerFailure as classifyRunnerFailureMatch,
  isRunnerSpawnFailure,
  matchesSignature,
} from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxMode, SandboxPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type {
  ShellExecRequest,
  ShellExecSpec,
  ShellExecution,
  ShellProcess,
  ShellRunResult,
} from '@deepseek-ai/dsh-shell'
import { composePath } from './paths.ts'

/**
 * A `LocalBashExecutor` that runs a specific bash executable instead of
 * whatever `bash` happens to be on PATH.
 *
 * Why subclass rather than write a new executor: `LocalBashExecutor` already
 * owns deadline arming, output collection and spilling, abort classification,
 * `dshEnv` merging and result shaping — all of it first-party behaviour this
 * plugin must not diverge from. The class documentation for `executeArgv`
 * explicitly frames it as the extension point for "replacing the public
 * command's shell argv at an execution boundary", which is exactly the change
 * being made here.
 *
 * Two things are overridden:
 *
 * - `execute(spec)` builds the argv from the configured executable. The base
 *   class hardcodes `['bash', '-c', command]`, which on Windows resolves
 *   `C:\Windows\System32\bash.exe` — the WSL launcher — so it cannot be reused.
 * - `resolve(request)` injects `PATH`. `spawnSpec` merges `spec.env` after the
 *   built-in overrides and before `dshEnv`, so `resolve()` is the only place
 *   where PATH can be supplied.
 *
 * Confinement follows the first-party `dsh-bash-sandbox` shape: the *same* argv
 * is handed to `SandboxProvider.confine()` so the provider's runner wraps our
 * bash rather than the system one, and "runner failed" facts are surfaced as
 * `SandboxUnavailableError` instead of pretending a broken sandbox was a
 * command failure.
 */

/** Extra config fields carried into the mounted executor. */
export interface GitBashExecutorConfig extends BashLocalConfig {
  /** Absolute path to bash.exe. */
  readonly bashPath: string
  /** Directories to prepend to PATH. */
  readonly pathEntries: readonly string[]
  /** Pass `-l`. */
  readonly loginShell: boolean
  /** Export PYTHONIOENCODING. */
  readonly pythonUtf8: boolean
}

/** What the sandbox reported for one execution, remembered until the process settles. */
interface ProcessFacts {
  readonly mode: SandboxMode
  readonly enforcement: 'full' | 'partial'
  readonly denialSignatures: readonly string[]
  readonly runnerFailureRules: ConfinedArgv['runnerFailureRules']
  readonly runnerProgram: string
  readonly workdir: string
}

export class GitBashExecutor extends LocalBashExecutor {
  /**
   * Only `subprocess` is injected. A composition without sandboxing must still
   * be able to mount this executor — the tool then simply has no escalation
   * parameter — so `sandbox` and `sandboxPolicy` are probed with `ctx.get()`,
   * matching how `tool-bash` treats them.
   */
  static inject = ['subprocess']

  private readonly facts = new Map<ShellProcess, ProcessFacts>()

  constructor(ctx: Context, config: GitBashExecutorConfig) {
    super(ctx, config)
  }

  private get extended(): GitBashExecutorConfig {
    return this.config as unknown as GitBashExecutorConfig
  }

  private get bashPath(): string {
    return this.extended.bashPath
  }

  private get pathEntries(): readonly string[] {
    return this.extended.pathEntries
  }

  private get loginShell(): boolean {
    return this.extended.loginShell === true
  }

  private get pythonUtf8(): boolean {
    return this.extended.pythonUtf8 !== false
  }

  private get sandbox(): SandboxProvider | undefined {
    return this.ctx.get('sandbox')
  }

  private get sandboxPolicy(): SandboxPolicyService | undefined {
    return this.ctx.get('sandboxPolicy')
  }

  /**
   * The standing sandbox mode, or `undefined` when this composition has no
   * sandbox provider. `tool-bash` reads this to decide whether to expose
   * `sandbox_permissions`; reporting a mode we cannot confine would advertise
   * an escalation that must fail.
   */
  override get sandboxMode(): SandboxMode | undefined {
    return this.sandbox === undefined ? undefined : this.sandboxPolicy?.defaultMode
  }

  /** The exact argv for one command. */
  argv(spec: ShellExecSpec): string[] {
    return [this.bashPath, ...(this.loginShell ? ['-l'] : []), '-c', spec.command]
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)

    // PATH is injected here because `spawnSpec` treats `spec.env` as the
    // caller-supplied environment and merges it over the built-in overrides.
    const env: Record<string, string> = {
      ...spec.env,
      PATH: composePath(this.pathEntries, spec.env?.PATH ?? process.env.PATH ?? process.env.Path),
    }
    // MSYS2 defaults to the ANSI code page for native Windows children, which
    // corrupts non-ASCII output. Forcing UTF-8 on Python is the one lever that
    // works from the environment alone (F14).
    if (this.pythonUtf8 && env.PYTHONIOENCODING === undefined) env.PYTHONIOENCODING = 'utf-8'

    return {
      ...spec,
      env,
      // `tool-bash` normally supplies the policy; this fallback keeps a direct
      // caller (tests, other tools) from reaching `confine()` with no policy.
      sandboxPolicy: spec.sandboxPolicy ?? this.sandboxPolicy?.resolve(),
    }
  }

  override async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    const sandbox = this.sandbox
    const policy = spec.sandboxPolicy
    const argv = this.argv(spec)

    // Unconfined: no provider, no policy, or an explicit escalation past the
    // sandbox. The argv is still ours, which is the whole point of this class.
    if (sandbox === undefined || policy === undefined || policy.mode === 'danger-full-access') {
      const mode: SandboxMode = policy?.mode ?? 'danger-full-access'
      const execution = await this.executeArgv(spec, argv)
      return decorateResult(execution, (result) => ({ ...result, sandbox: { mode, denied: false } }))
    }

    const mode = policy.mode
    const confinedPolicy: SandboxPolicy = { ...policy, mode }

    let confined: ConfinedArgv | undefined
    const execution = await this.executeArgv(
      spec,
      async (signal) => {
        const prepared = await sandbox.confine(argv, confinedPolicy, signal)
        signal.throwIfAborted()
        confined = prepared
        return prepared.argv
      },
      (process) => {
        const prepared = confined
        if (prepared === undefined) return
        this.facts.set(process, {
          mode,
          enforcement: prepared.enforcement,
          denialSignatures: prepared.denialSignatures,
          runnerFailureRules: prepared.runnerFailureRules,
          runnerProgram: prepared.argv[0] ?? argv[0] ?? this.bashPath,
          workdir: spec.workdir,
        })
      },
    )

    return decorateResult(
      execution,
      (result) => {
        if (confined === undefined) return { ...result, sandbox: { mode, denied: false } }
        const failure = classifyRunnerFailureMatch(result.exitCode, result.stderr.text, confined.runnerFailureRules)
        if (failure !== undefined) {
          // A sandbox that cannot launch bash is an environment problem, not a
          // command result; surfacing it as such is what lets the UI say so.
          throw new SandboxUnavailableError(mode, failure.detail)
        }
        return {
          ...result,
          sandbox: {
            mode,
            denied: matchesSignature(result.exitCode, result.stderr.text, confined.denialSignatures),
            enforcement: confined.enforcement,
          },
        }
      },
      (error) => {
        if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
        if (confined === undefined) throw error
        if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
          throw new SandboxUnavailableError(mode, error instanceof Error ? error.message : String(error))
        }
        throw error
      },
    )
  }

  protected override onProcessDone(
    process: ShellProcess,
    stderr: string,
    providerRejected: boolean,
    providerError?: unknown,
  ): void {
    const facts = this.facts.get(process)
    this.facts.delete(process)
    if (facts !== undefined) {
      const runnerFailed = providerRejected
        ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir)
        : classifyRunnerFailureMatch(process.exitCode, stderr, facts.runnerFailureRules) !== undefined
      process.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature(process.exitCode, stderr, facts.denialSignatures),
        enforcement: facts.enforcement,
        ...(runnerFailed ? { runnerFailed: true } : {}),
      }
    }
    super.onProcessDone(process, stderr, providerRejected, providerError)
  }
}

/**
 * Replace `execution.result()` in place.
 *
 * Handle identity must be preserved: sandbox facts are keyed by the handle and
 * read back by the base class, so wrapping the handle in another object would
 * drop them.
 */
function decorateResult<T extends ShellExecution>(
  execution: T,
  map: (result: ShellRunResult) => ShellRunResult,
  mapError?: (error: unknown) => never,
): T {
  const base = execution.result.bind(execution)
  let decorated: Promise<ShellRunResult> | undefined
  execution.result = () => {
    decorated ??= mapError === undefined ? base().then(map) : base().then(map, mapError)
    return decorated
  }
  return execution
}
