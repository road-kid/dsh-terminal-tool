import { build } from 'esbuild'
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Build script.
 *
 * The published artifact is plain ESM in `lib/`. First-party `@deepseek-ai/*`
 * packages are *external*: the harness resolves them for the profile through
 * its installation scope, and bundling them would duplicate service classes and
 * break the instanceof/identity checks cordis relies on.
 *
 * Type declarations are emitted by hand rather than by `tsc` because the runtime
 * (and therefore the types) only needs the plugin entry plus a couple of public
 * helpers, and `tsc --emitDeclarationOnly` would drag the whole first-party
 * `.d.ts` graph into the package.
 */

const root = dirname(fileURLToPath(import.meta.url))
const outdir = join(root, 'lib')

const external = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-shell',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tools',
  'node:*',
]

await rm(outdir, { recursive: true, force: true })
await mkdir(join(outdir, 'types'), { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(outdir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'warning',
  legalComments: 'none',
})

// Second entry for the local test harness only. Keeping it in the same bundle
// step means the integration test exercises exactly the code that ships.
await build({
  entryPoints: [join(root, 'src', 'testing.ts')],
  outfile: join(outdir, 'testing.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'warning',
  legalComments: 'none',
})

// Client half: served to the Web renderer by `dsh-client-modules`, which loads
// it as one classic script and expects the `window.__ModuleLoader__.load` shape.
// `react` and its JSX runtime stay external: the page seeds them, and a second
// copy of React inside this bundle would break hook identity.
await build({
  entryPoints: [join(root, 'src', 'client', 'index.ts')],
  outfile: join(outdir, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  external: ['react', 'react/jsx-runtime'],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-terminal-tool", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'warning',
  legalComments: 'none',
})

await mkdir(join(outdir, 'types', 'client'), { recursive: true })

// The client declaration only needs the shape the loader calls; nothing imports
// the row component from another package.
await writeFile(
  join(outdir, 'types', 'client', 'index.d.ts'),
  `export declare const name = 'terminal-tool'
export declare const inject: string[]
export declare function apply(ctx: unknown): void
`,
  'utf8',
)

// A declaration file that mirrors the public surface without a compiler pass.
// The import chain is inlined on purpose: `lib/` ships no `.ts` sources, so a
// `from './config.ts'` re-export would dangle for consumers resolving types.
const declaration = `import type { Context } from '@deepseek-ai/cordis'
import type { Config as BashLocalConfig } from '@deepseek-ai/dsh-bash-local'
import z from '@deepseek-ai/schemastery'

export declare const name = 'terminal-tool'
export declare const inject: string[]
export type RawConfig = BashLocalConfig & {
  readonly dialect: 'pwsh' | 'bash'
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly discoverTimeoutMs: number
  readonly loginShell: boolean
  readonly extraPath: readonly string[]
  readonly pythonUtf8: boolean
}
export type SkipReason =
  | 'not-win32'
  | 'dialect-pwsh'
  | 'no-agent-context'
  | 'already-replaced'
  | 'bash-not-found'
  | 'missing-service'
  | 'mount-failed'
export type InstallResult =
  | { readonly status: 'installed'; readonly bashPath: string }
  | { readonly status: 'skipped'; readonly reason: SkipReason; readonly detail?: string }
export declare const Config: z<RawConfig>
export declare function apply(ctx: Context, config: RawConfig): void
export declare function installResultFor(agentId: string): InstallResult | undefined
`
await writeFile(join(outdir, 'types', 'index.d.ts'), declaration, 'utf8')

const size = (await readFile(join(outdir, 'index.js'))).length
process.stdout.write(`built lib/index.js (${size} bytes)\n`)
