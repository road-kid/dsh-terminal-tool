import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

/**
 * How a Git Bash command is launched when the standing sandbox is confined.
 *
 * The Windows sandbox lowers the child to Low integrity, which makes the MSYS2
 * runtime fail while it creates its named shared memory. This policy decides
 * what the executor does about that, without the plugin ever approving an
 * escalation itself (that belongs to the first-party `tool-bash`).
 */
export type ConfinedPolicy = 'unconfined' | 'escalate' | 'fail'

/**
 * Stderr substrings that identify an MSYS2 startup denial.
 *
 * Lower-case on purpose: `isMsysStartupDenial` lower-cases the collected
 * stderr before matching, so these are plain substrings rather than regexes.
 */
export const MSYS_DENIAL_SIGNATURES: readonly string[] = [
  'ntcreatedirectoryobject(\\basenamedobjects\\msys-',
  "couldn't create signal pipe",
]

/**
 * Process status codes MSYS2 uses when it cannot initialize:
 *
 * - `3221225794` = `0xC0000142` (`STATUS_DLL_INIT_FAILED`);
 * - `3221225506` = `0xC0000022` (`STATUS_ACCESS_DENIED`).
 */
export const MSYS_DENIAL_EXIT_CODES: readonly number[] = [3221225794, 3221225506]

/**
 * Whether a failed Git Bash launch died during MSYS2 startup rather than
 * failing at the command itself.
 *
 * The exit code is checked first because a low-integrity denial is definitive
 * even when stderr was never collected; the stderr signatures then cover
 * shells that print the runtime diagnostic and exit through another status.
 *
 * @param exitCode - the process exit status, `null` when signal-killed.
 * @param stderr - the collected stderr text.
 */
export function isMsysStartupDenial(exitCode: number | null | undefined, stderr: string): boolean {
  if (exitCode !== null && exitCode !== undefined && MSYS_DENIAL_EXIT_CODES.includes(exitCode)) return true
  const lowered = stderr.toLowerCase()
  return MSYS_DENIAL_SIGNATURES.some((signature) => lowered.includes(signature))
}

/** Inputs to the launch decision for one execution. */
export interface LaunchInput {
  /** Whether this composition has a sandbox provider at all. */
  readonly hasSandbox: boolean
  /** The resolved per-call policy mode, when the caller supplied one. */
  readonly policyMode: SandboxMode | undefined
  /** The configured handling for confined Windows launches. */
  readonly choice: ConfinedPolicy
  /** The host platform (`process.platform`). */
  readonly platform: NodeJS.Platform
}

/**
 * The launch strategy for one execution:
 *
 * - `direct` runs the configured bash argv without the sandbox;
 * - `confine` hands the same argv to `SandboxProvider.confine()`;
 * - `fail` refuses to run and reports why.
 */
export type LaunchPlan =
  | { readonly kind: 'confine' }
  | { readonly kind: 'direct' }
  | { readonly kind: 'fail'; readonly reason: string }

/**
 * Decide how one execution should be launched.
 *
 * Only Windows needs the policy: on every other platform the sandbox can start
 * MSYS2 itself, so a confined mode is always honoured. On Windows, a confined
 * mode cannot start Git Bash, and the configured choice decides between
 * running unconfined, failing so the first-party tool can offer its escalation,
 * or failing with a configuration error.
 *
 * @param input - the provider, policy, choice and platform facts.
 */
export function planLaunch(input: LaunchInput): LaunchPlan {
  // No sandbox, or the caller passed no policy: there is nothing to confine.
  if (!input.hasSandbox || input.policyMode === undefined) return { kind: 'direct' }
  // An explicit escalation past the sandbox is the pre-existing behaviour.
  if (input.policyMode === 'danger-full-access') return { kind: 'direct' }
  // Non-Windows MSYS starts fine under a confined sandbox.
  if (input.platform !== 'win32') return { kind: 'confine' }
  if (input.choice === 'unconfined') return { kind: 'direct' }
  if (input.choice === 'escalate') return { kind: 'confine' }
  return { kind: 'fail', reason: unavailableReason(input.policyMode) }
}

/** The configuration-level explanation for a `fail` plan. */
function unavailableReason(mode: SandboxMode): string {
  return (
    `Git Bash cannot start under the ${mode} sandbox on Windows; ` +
    'set confinedPolicy to "unconfined" or retry with sandbox_permissions: danger-full-access'
  )
}
