import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Diagnostics.
 *
 * The plugin's failure mode is "stay out of the way": on any problem it must
 * leave the session with the stock pwsh tool rather than break agent creation.
 * That means failures are *reported*, not thrown — which is only useful if the
 * report is somewhere the user can find it. A single append-only log file is
 * the least invasive option: no service required, no UI, no console noise.
 *
 * `DSH_TERMINAL_TOOL_DIAG_FILE` overrides the location (used by the selftest), and
 * writes are best-effort: a diagnostics failure must never become a session
 * failure.
 */

const LOG_NAME = 'dsh-terminal-tool.log'

/** Where the diagnostic log lives. */
export function diagnosticPath(): string {
  const configured = process.env.DSH_TERMINAL_TOOL_DIAG_FILE
  if (configured !== undefined && configured.trim() !== '') return configured
  return join(tmpdir(), LOG_NAME)
}

function stamp(): string {
  return new Date().toISOString()
}

/** Append one line to the diagnostic log. Never throws. */
export function writeDiagnostic(message: string): void {
  const line = `[${stamp()}] ${message}\n`
  try {
    const path = diagnosticPath()
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, line, 'utf8')
  } catch {
    // Diagnostics are best-effort by contract.
  }
}

/** A recorded reason a session was left untouched. */
export type SkipReason =
  | 'not-win32'
  | 'dialect-pwsh'
  | 'no-agent-context'
  | 'already-replaced'
  | 'bash-not-found'
  | 'missing-service'
  | 'minimal-left'
  | 'mount-failed'

/**
 * Record why a session keeps the stock terminal tool, and return the reason so
 * callers can bubble it up without a second log call.
 */
export function skip(sessionId: string, reason: SkipReason, detail?: string): SkipReason {
  const suffix = detail === undefined || detail === '' ? '' : `: ${detail}`
  writeDiagnostic(`skip session=${sessionId} reason=${reason}${suffix}`)
  return reason
}

/** Record a non-fatal problem that did not prevent replacement. */
export function warn(sessionId: string, message: string): void {
  writeDiagnostic(`warn session=${sessionId} ${message}`)
}

/** Record a successful replacement. */
export function note(sessionId: string, message: string): void {
  writeDiagnostic(`ok session=${sessionId} ${message}`)
}
