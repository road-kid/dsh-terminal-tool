/**
 * Shared shapes.
 *
 * Anything that would normally be an imported first-party type lives here only
 * when the corresponding service is *optional at runtime*: the plugin probes
 * services with `ctx.get()` so that a composition without sandboxing (or
 * without our tool layer) degrades into a diagnostic instead of a load error.
 */

/** Where a discovered shell came from, for diagnostics and tests. */
export type DiscoverySource =
  | 'configured'
  | 'candidate'
  | 'registry'
  | 'program-files'
  | 'msys2'
  | 'cygwin'
  | 'path'

/** One discovered bash executable plus where it was found. */
export interface DiscoveredBash {
  /** Absolute path to the bash executable. */
  readonly path: string
  readonly source: DiscoverySource
}

/** Result of a discovery sweep: the winner (if any) plus every rejected reason. */
export interface DiscoveryReport {
  readonly found: DiscoveredBash | undefined
  readonly considered: readonly string[]
  readonly rejected: readonly { readonly path: string; readonly reason: string }[]
}
