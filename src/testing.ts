/**
 * Test-only entry point.
 *
 * `lib/index.js` is the cordis plugin: it exports `apply`/`name`/`inject` and
 * nothing else, because a plugin's export surface is part of its contract. The
 * integration test still needs the individual steps, so they are exposed here
 * and bundled separately. Nothing imports this file at runtime.
 */

export { installSession } from './replace.ts'
export type { InstallResult } from './replace.ts'
export { snapshotConfig } from './config.ts'
export type { ConfigSnapshot } from './config.ts'
export { GitBashExecutor } from './executor.ts'
export { discoverBash } from './discover.ts'
export { diagnosticPath, writeDiagnostic } from './diag.ts'
