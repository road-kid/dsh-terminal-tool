/**
 * Self-test.
 *
 * Exercises the parts of the plugin that can be verified without a live
 * harness: config snapshotting, path arithmetic, PATH composition, WSL
 * exclusion and the discovery sweep. It deliberately does not mount the plugin
 * into a cordis app — that requires the first-party runtime, which the harness
 * resolves only inside a profile; `contractcheck.mjs` covers the static
 * contract, and the real integration check is installing the plugin and
 * starting a session.
 *
 * Run with `npm run selftest`. Exits non-zero on the first failure.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  bashInstallRoot,
  bashPathEntries,
  candidateExecutables,
  composePath,
  dedupe,
  isWslBash,
  pathKey,
  samePath,
  validateBashPath,
} from '../src/paths.ts'
import { discoverBash, scanBashCandidates } from '../src/discover.ts'
import { createHandlers } from '../src/routes.ts'
import { createRowController, createStore, INITIAL_ROW_STATE, knownPaths } from '../src/client/store.ts'
import { executorConfig, snapshotConfig, wantsBash } from '../src/config.ts'

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

/** A throwaway bash installation laid out like Git for Windows. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gbt-selftest-'))
  const bin = join(root, 'bin')
  const usrBin = join(root, 'usr', 'bin')
  await mkdir(bin, { recursive: true })
  await mkdir(usrBin, { recursive: true })
  await writeFile(join(bin, 'bash.exe'), '')
  await writeFile(join(usrBin, 'bash.exe'), '')
  return root
}

// --- pathKey / samePath ----------------------------------------------------

await test('pathKey folds separators, case and trailing separators', () => {
  assert.equal(pathKey('C:/Program Files/Git/bin/'), pathKey('c:\\program files\\git\\bin'))
  assert.equal(pathKey('C:\\'), pathKey('C:/'))
})

await test('samePath is reflexive over equivalent forms', () => {
  assert.equal(samePath('C:\\Program Files\\Git', 'c:/program files/git/'), true)
  assert.equal(samePath('C:\\a', 'C:\\b'), false)
})

// --- bashInstallRoot -------------------------------------------------------

await test('bashInstallRoot strips <root>\\bin', () => {
  assert.equal(pathKey(bashInstallRoot('C:\\Program Files\\Git\\bin\\bash.exe')), pathKey('C:\\Program Files\\Git'))
})

await test('bashInstallRoot strips <root>\\usr\\bin by two levels', () => {
  assert.equal(pathKey(bashInstallRoot('C:\\Program Files\\Git\\usr\\bin\\bash.exe')), pathKey('C:\\Program Files\\Git'))
})

await test('bashInstallRoot falls back to the executable directory', () => {
  assert.equal(pathKey(bashInstallRoot('D:\\portable\\weird\\bash.exe')), pathKey('D:\\portable\\weird'))
})

// --- dedupe / composePath --------------------------------------------------

await test('dedupe keeps the first occurrence and drops case variants', () => {
  assert.deepEqual(dedupe(['C:\\a', 'c:/A', 'C:\\b']), ['C:\\a', 'C:\\b'])
})

await test('composePath puts the plugin entries first and keeps host PATH', () => {
  const composed = composePath(['C:\\git\\usr\\bin'], 'C:\\Windows\\System32;C:\\git\\usr\\bin')
  assert.deepEqual(composed.split(';'), ['C:\\git\\usr\\bin', 'C:\\Windows\\System32'])
})

await test('composePath tolerates an undefined host PATH', () => {
  assert.equal(composePath(['C:\\a'], undefined), 'C:\\a')
})

// --- WSL exclusion ---------------------------------------------------------

await test('isWslBash rejects the System32 launcher', () => {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  assert.equal(isWslBash(join(systemRoot, 'System32', 'bash.exe')), true)
})

await test('isWslBash rejects the WindowsApps alias', () => {
  assert.equal(isWslBash('C:\\Users\\someone\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe'), true)
})

await test('isWslBash accepts Git Bash', () => {
  assert.equal(isWslBash('C:\\Program Files\\Git\\bin\\bash.exe'), false)
})

// --- validateBashPath ------------------------------------------------------

await test('validateBashPath rejects relative and mis-named executables', () => {
  assert.equal(validateBashPath('bash.exe').ok, false)
  assert.equal(validateBashPath('C:\\Program Files\\Git\\bin\\notbash.exe').ok, false)
})

await test('validateBashPath rejects the WSL launcher', () => {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const verdict = validateBashPath(join(systemRoot, 'System32', 'bash.exe'))
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /WSL/)
})

// --- candidateExecutables --------------------------------------------------

await test('candidateExecutables expands an installation root', async () => {
  const root = await fixture()
  try {
    const found = candidateExecutables(root)
    assert.ok(found.some((path) => pathKey(path) === pathKey(join(root, 'bin', 'bash.exe'))))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('candidateExecutables passes through an explicit executable', async () => {
  const root = await fixture()
  try {
    const executable = join(root, 'bin', 'bash.exe')
    assert.deepEqual(candidateExecutables(executable), [executable])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// --- bashPathEntries -------------------------------------------------------

await test('bashPathEntries orders toolchain, usr/bin, bin and only existing dirs', async () => {
  const root = await fixture()
  try {
    await mkdir(join(root, 'mingw64', 'bin'), { recursive: true })
    const entries = bashPathEntries(root)
    assert.equal(pathKey(entries[0]), pathKey(join(root, 'mingw64', 'bin')))
    assert.ok(entries.some((entry) => pathKey(entry) === pathKey(join(root, 'usr', 'bin'))))
    assert.ok(entries.some((entry) => pathKey(entry) === pathKey(join(root, 'bin'))))
    assert.ok(!entries.some((entry) => pathKey(entry) === pathKey(join(root, 'ucrt64', 'bin'))))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// --- discovery -------------------------------------------------------------

await test('discovery honours an explicit bashPath', async () => {
  const root = await fixture()
  try {
    const report = await discoverBash({
      bashPath: join(root, 'bin', 'bash.exe'),
      bashCandidates: [],
      autoDiscover: true,
      timeoutMs: 500,
    })
    assert.equal(report.found?.source, 'configured')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('discovery finds a bash under an explicit candidate root', async () => {
  const root = await fixture()
  try {
    const report = await discoverBash({
      bashPath: '',
      bashCandidates: [root],
      autoDiscover: true,
      timeoutMs: 500,
    })
    assert.equal(report.found?.source, 'candidate')
    assert.equal(pathKey(report.found.path), pathKey(join(root, 'bin', 'bash.exe')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('discovery reports a rejection reason for a bad configured path', async () => {
  const report = await discoverBash({
    bashPath: 'C:\\definitely\\not\\here\\bash.exe',
    bashCandidates: [],
    autoDiscover: false,
    timeoutMs: 100,
  })
  assert.equal(report.found, undefined)
  assert.ok(report.rejected.length > 0)
})

// --- config ----------------------------------------------------------------

await test('snapshotConfig defaults to pwsh so installing changes nothing', () => {
  const snapshot = snapshotConfig({})
  assert.equal(snapshot.dialect, 'pwsh')
  assert.equal(wantsBash(snapshot), false)
})

await test('snapshotConfig reads volatile { get } references', () => {
  const snapshot = snapshotConfig({
    dialect: { get: () => 'bash' },
    bashPath: { get: () => '  C:\\Git\\bin\\bash.exe  ' },
    bashCandidates: { get: () => ['C:\\Git'] },
    autoDiscover: { get: () => true },
    discoverTimeoutMs: { get: () => 900 },
    loginShell: { get: () => true },
    extraPath: { get: () => ['C:\\extra'] },
    pythonUtf8: { get: () => false },
    timeoutMs: { get: () => 45000 },
  })
  assert.equal(snapshot.dialect, 'bash')
  assert.equal(wantsBash(snapshot), true)
  assert.equal(snapshot.bashPath, 'C:\\Git\\bin\\bash.exe')
  assert.deepEqual(snapshot.bashCandidates, ['C:\\Git'])
  assert.equal(snapshot.loginShell, true)
  assert.equal(snapshot.pythonUtf8, false)
  assert.equal(snapshot.timeoutMs, 45000)
})

await test('executorConfig passes plain values, not volatile wrappers', () => {
  const snapshot = snapshotConfig({ timeoutMs: { get: () => 45000 }, cwd: { get: () => 'C:\\work' } })
  const args = executorConfig(snapshot)
  assert.equal(args.timeoutMs, 45000)
  assert.equal(args.cwd, 'C:\\work')
})

// --- settings-row read surface ---------------------------------------------

await test('scanBashCandidates returns every usable bash, not just the first', async () => {
  const root = await fixture()
  try {
    const candidates = await scanBashCandidates({
      bashPath: '',
      bashCandidates: [root],
      autoDiscover: true,
      timeoutMs: 500,
    })
    // The fixture ships bin\bash.exe and usr\bin\bash.exe: the picker needs both,
    // while discoverBash (a session needs one executor) stops at the first.
    // Both fixtures appear; a real Git Bash on the machine may add more, so
    // assert containment rather than an exact count.
    assert.ok(candidates.every((candidate) => candidate.valid))
    const paths = candidates.map((candidate) => pathKey(candidate.path))
    assert.ok(paths.includes(pathKey(join(root, 'bin', 'bash.exe'))))
    assert.ok(paths.includes(pathKey(join(root, 'usr', 'bin', 'bash.exe'))))
    assert.equal(new Set(paths).size, paths.length, 'no duplicate paths')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('scanBashCandidates keeps the saved path selectable', async () => {
  const root = await fixture()
  try {
    const saved = join(root, 'bin', 'bash.exe')
    const candidates = await scanBashCandidates({
      bashPath: saved,
      bashCandidates: [],
      autoDiscover: true,
      timeoutMs: 500,
    })
    // The saved path is ranked first; a real Git Bash on this machine may be
    // listed after it, which is exactly the point of the picker.
    assert.equal(candidates[0].source, 'configured')
    assert.equal(pathKey(candidates[0].path), pathKey(saved))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('/state reports the snapshot without scanning', async () => {
  const handlers = createHandlers({
    readSnapshot: () =>
      snapshotConfig({ dialect: { get: () => 'bash' }, bashPath: { get: () => 'C:\Git\bin\bash.exe' } }),
    capability: () => ({ supported: true }),
    settingsAvailable: () => true,
    lastReplace: () => ({ at: 1700000000000, applied: true }),
  })
  const state = handlers.state()
  assert.equal(state.platform, process.platform)
  assert.equal(state.dialect, 'bash')
  assert.equal(state.bashPath, 'C:\Git\bin\bash.exe')
  assert.equal(state.settingsAvailable, true)
  assert.equal(state.capability.supported, true)
  assert.equal(state.lastReplace?.applied, true)
  // No candidates on the wire: a sweep spawns reg.exe, and this runs on mount.
  assert.equal('candidates' in state, false)
})

await test('/discover prefers the in-flight path over the saved one', async () => {
  const root = await fixture()
  try {
    const inFlight = join(root, 'bin', 'bash.exe')
    const handlers = createHandlers({
      readSnapshot: () => snapshotConfig({}),
      capability: () => ({ supported: true }),
      settingsAvailable: () => true,
      lastReplace: () => undefined,
    })
    const view = await handlers.discover({ bashPath: inFlight })
    assert.ok(view.candidates.length >= 1)
    assert.equal(pathKey(view.candidates[0].path), pathKey(inFlight))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
