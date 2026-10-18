/**
 * Contract check.
 *
 * The parts of the plugin that a live session depends on are structural: the
 * config must project into the settings form, the bundle patch must be a valid
 * one-line insert, and the build output must export the plugin shape cordis
 * looks for. Each of those is easy to break silently during a refactor, so they
 * are asserted here against the built artifact and the package manifest.
 *
 * Run with `npm run contractcheck` (after `npm run build`).
 */

import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

let passed = 0
let failed = 0

async function test(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`ok   ${name}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

await test('package declares the dsh bundle patch', () => {
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
})

await test('every file referenced by the manifest exists', async () => {
  for (const file of ['lib/index.js', 'lib/types/index.d.ts', 'lib/client.js', 'lib/types/client/index.d.ts', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'assets/icon.svg']) {
    await access(join(root, file))
  }
})

await test('exports expose the plugin entry, locale, icon and patch', () => {
  assert.equal(pkg.exports['.'].default, './lib/index.js')
  assert.equal(pkg.exports['.'].types, './lib/types/index.d.ts')
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.exports['./client'].types, './lib/types/client/index.d.ts')
  assert.equal(pkg.exports['./icon'], './assets/icon.svg')
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
})

await test('manifest declares the Web client half the loader scans for', () => {
  assert.equal(pkg.dsh?.client?.platform, 'web')
  for (const file of ['lib/client.js', 'lib/client.js.map']) {
    assert.ok(pkg.files.includes(file), `${file} must ship`)
  }
})

// `dsh-client-modules` refuses to activate a package that declares `dsh.client`
// but exports no `./client` bundle, and the served script must register itself
// with the page loader — a plain ESM/CJS bundle would load and do nothing.
await test('client bundle has the module-loader script shape', async () => {
  const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')
  assert.match(source, /^window\.__ModuleLoader__\.load\(\{ id: "dsh-terminal-tool", factory: \(require\) => \{/)
  assert.match(source, /return module\.exports; \} \}\);?\s*(\/\/# sourceMappingURL=.*)?$/m)
})

await test('client bundle keeps react external and registers the General row', async () => {
  const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')
  assert.match(source, /require\("react"\)/)
  assert.match(source, /require\("react\/jsx-runtime"\)/)
  assert.match(source, /settings\.general\.item/)
  assert.match(source, /configForms/)
  // A bundled React would duplicate the page's hook dispatcher.
  assert.doesNotMatch(source, /react\.production|react\.development/)
})

await test('bundle patch inserts exactly one Windows-guarded row', async () => {
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  const inserts = patch.match(/-\s+insert:/g) ?? []
  assert.equal(inserts.length, 1, 'exactly one insert block')
  assert.match(patch, /id:\s*terminal-tool/)
  assert.match(patch, /name:\s*dsh-terminal-tool/)
  assert.match(patch, /disabled:\s*!!js process\.platform !== 'win32'/)
})

await test('locale files declare display metadata', async () => {
  for (const file of ['locale/en.json', 'locale/zh.json']) {
    const json = JSON.parse(await readFile(join(root, file), 'utf8'))
    assert.equal(typeof json.meta?.title, 'string', `${file} meta.title`)
    assert.equal(typeof json.meta?.description, 'string', `${file} meta.description`)
  }
})

// --- built artifact --------------------------------------------------------

const mod = await import(new URL('../lib/index.js', import.meta.url).href)

await test('built module exports the cordis plugin shape', () => {
  assert.equal(mod.name, 'terminal-tool')
  assert.equal(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject))
  assert.ok(mod.Config !== undefined)
})

await test('Config validates and every plugin field is volatile', async () => {
  const result = mod.Config['~standard'].validate({})
  assert.equal(result.issues, undefined, `validation issues: ${JSON.stringify(result.issues)}`)
  const value = result.value

  // Volatile fields arrive as { get } references; that is precisely what makes
  // them visible in the settings form.
  for (const field of [
    'dialect',
    'bashPath',
    'bashCandidates',
    'autoDiscover',
    'discoverTimeoutMs',
    'loginShell',
    'extraPath',
    'pythonUtf8',
  ]) {
    assert.equal(typeof value[field]?.get, 'function', `${field} must be volatile`)
  }

  // The executor fields are inherited from LocalBashExecutor and are volatile there.
  for (const field of ['timeoutMs', 'maxTimeoutMs', 'maxOutputBytes', 'maxSpillBytes', 'graceMs']) {
    assert.equal(typeof value[field]?.get, 'function', `${field} must be volatile`)
  }
})

await test('Config defaults leave the session on pwsh', () => {
  const value = mod.Config['~standard'].validate({}).value
  assert.equal(value.dialect.get(), 'pwsh')
  assert.equal(value.autoDiscover.get(), true)
  assert.equal(value.loginShell.get(), false)
  assert.equal(value.pythonUtf8.get(), true)
})

await test('Config rejects an unknown dialect', () => {
  const result = mod.Config['~standard'].validate({ dialect: 'cmd' })
  assert.notEqual(result.issues, undefined)
})

await test('built bundle keeps first-party packages external', async () => {
  const source = await readFile(join(root, 'lib', 'index.js'), 'utf8')
  // A bundled first-party package would inline its service class definitions;
  // the marker for that is an import being absent while its symbols appear.
  assert.match(source, /from "@deepseek-ai\/dsh-bash-local"/)
  assert.match(source, /from "@deepseek-ai\/dsh-sandbox"/)
  assert.match(source, /from "@deepseek-ai\/dsh-tool-bash"/)
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
