/**
 * Host / client wire protocol (plain data: no node, no DOM, no React).
 *
 * Only the two exact Fetch routes under `/api` are used:
 *
 * - `POST /api/dsh-terminal-tool/state`    — platform, settings availability,
 *   current values, capability probe. **Never scans**: the settings row reads
 *   this on every mount and a sweep spawns `reg.exe`.
 * - `POST /api/dsh-terminal-tool/discover` — rescan candidates (pure query, no
 *   side effects). Only called when the user clicks 自动发现.
 *
 * Persistence does **not** go through these routes: the browser half edits the
 * plugin's own entry Config through the official `configForms` service, so the
 * write lands in the profile patch layer exactly like a first-party setting.
 */

/**
 * Settings namespace — the profile entry id of this plugin.
 *
 * Since DSH 0.1.7 the settings model is "a plugin entry's own Config": the form
 * is addressed by entry id, and `configForms.get(entryId)` only resolves once
 * the Host serves that namespace. This value must therefore match the `id` in
 * `cordis.patch.yml` verbatim.
 */
export const SETTINGS_NAMESPACE = 'terminal-tool'

/** State endpoint path. */
export const ROUTE_STATE = '/api/dsh-terminal-tool/state'

/** Discovery endpoint path. */
export const ROUTE_DISCOVER = '/api/dsh-terminal-tool/discover'

/** Which terminal tool a session gets. */
export type Dialect = 'pwsh' | 'bash'

/** One discovered bash executable (the client only reads this subset). */
export interface CandidateView {
  readonly path: string
  readonly source:
    | 'saved'
    | 'configured'
    | 'candidate'
    | 'registry'
    | 'program-files'
    | 'msys2'
    | 'cygwin'
    | 'path'
  readonly valid: boolean
}

/**
 * One candidate as the Host reports it to itself (the full sweep result).
 *
 * `CandidateView` is the wire projection of this shape; the extra type exists
 * because the Host also needs candidates that failed validation, so it can log
 * *why* a bash was rejected rather than only that nothing was found.
 */
export interface BashCandidate {
  readonly path: string
  readonly source: CandidateView['source']
  readonly valid: boolean
}

/** Host-side capability probe: is the replacement chain available at all? */
export interface CapabilityView {
  readonly supported: boolean
  readonly reason?: string
}

/** Result of the most recent per-session replacement attempt. */
export interface ReplaceReport {
  readonly at: number
  readonly applied: boolean
  readonly reason?: string
}

/**
 * `/state` response.
 *
 * Deliberately contains **no candidates**: a sweep shells out to `reg.exe` and
 * stats the filesystem, while the settings row reads this on every mount.
 */
export interface StateView {
  /** `process.platform` — the row only renders on win32. */
  readonly platform: string
  /** Whether the Host settings service is visible (the form is writable). */
  readonly settingsAvailable: boolean
  /** Current dialect as the Host reads it (fallback before the form is ready). */
  readonly dialect: Dialect
  readonly bashPath: string
  /** Persisted candidate list from the last 自动发现 sweep. */
  readonly bashCandidates: readonly string[]
  readonly capability: CapabilityView
  readonly lastReplace?: ReplaceReport
}

/** `/discover` response. */
export interface DiscoverView {
  readonly candidates: readonly CandidateView[]
}
