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
import { createHandlers, registerRoutes } from '../src/routes.ts'
import { createRowController, createStore, INITIAL_ROW_STATE, knownPaths } from '../src/client/store.ts'
import { executorConfig, snapshotConfig, wantsBash } from '../src/config.ts'
import { isMsysStartupDenial, planLaunch, MSYS_DENIAL_EXIT_CODES } from '../src/confined.ts'
import {
  cloneMinimalForGitBash,
  createVariantManager,
  formatPresetRows,
  MINIMAL_ID,
  parsePresetRows,
  VARIANT_ID,
} from '../src/preset.ts'

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
  assert.equal(snapshot.confinedPolicy, 'unconfined')
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
  assert.equal(args.confinedPolicy, 'unconfined')
})

await test('snapshotConfig reads every confinedPolicy value', () => {
  for (const value of ['unconfined', 'escalate', 'fail']) {
    assert.equal(snapshotConfig({ confinedPolicy: value }).confinedPolicy, value)
    assert.equal(snapshotConfig({ confinedPolicy: { get: () => value } }).confinedPolicy, value)
  }
  assert.equal(executorConfig(snapshotConfig({ confinedPolicy: 'fail' })).confinedPolicy, 'fail')
})

await test('snapshotConfig falls back to unconfined for an unknown confinedPolicy', () => {
  // A profile edited by hand must not leave the session without a terminal
  // tool just because the value is a typo.
  assert.equal(snapshotConfig({ confinedPolicy: 'always' }).confinedPolicy, 'unconfined')
  assert.equal(snapshotConfig({ confinedPolicy: { get: () => 42 } }).confinedPolicy, 'unconfined')
})

// --- confined launch planning ----------------------------------------------

await test('isMsysStartupDenial recognises the MSYS2 crash on Windows', () => {
  const crash =
    'fatal error - NtCreateDirectoryObject(\\BaseNamedObjects\\msys-2.0S5-1888ae32e00d56aa): 0xC0000022'
  assert.equal(isMsysStartupDenial(MSYS_DENIAL_EXIT_CODES[0], crash), true)
  assert.equal(isMsysStartupDenial(MSYS_DENIAL_EXIT_CODES[1], ''), true)
  assert.equal(isMsysStartupDenial(1, "fatal error - couldn't create signal pipe, Win32 error 5"), true)
  assert.equal(isMsysStartupDenial(null, crash.toUpperCase()), true)
})

await test('isMsysStartupDenial ignores ordinary command failures', () => {
  assert.equal(isMsysStartupDenial(1, 'bash: nope: command not found'), false)
  assert.equal(isMsysStartupDenial(0, ''), false)
  assert.equal(isMsysStartupDenial(null, ''), false)
  // The signature must be the MSYS banner, not a generic access-denied word.
  assert.equal(isMsysStartupDenial(1, 'access denied'), false)
})

await test('planLaunch runs directly when there is nothing to confine', () => {
  assert.deepEqual(
    planLaunch({ hasSandbox: false, policyMode: 'workspace-write', choice: 'fail', platform: 'win32' }),
    { kind: 'direct' },
  )
  assert.deepEqual(
    planLaunch({ hasSandbox: true, policyMode: undefined, choice: 'escalate', platform: 'win32' }),
    { kind: 'direct' },
  )
  assert.deepEqual(
    planLaunch({ hasSandbox: true, policyMode: 'danger-full-access', choice: 'escalate', platform: 'win32' }),
    { kind: 'direct' },
  )
})

await test('planLaunch confines outside Windows and follows the Windows policy', () => {
  assert.deepEqual(
    planLaunch({ hasSandbox: true, policyMode: 'read-only', choice: 'unconfined', platform: 'linux' }),
    { kind: 'confine' },
  )
  assert.deepEqual(
    planLaunch({ hasSandbox: true, policyMode: 'workspace-write', choice: 'unconfined', platform: 'win32' }),
    { kind: 'direct' },
  )
  assert.deepEqual(
    planLaunch({ hasSandbox: true, policyMode: 'workspace-write', choice: 'escalate', platform: 'win32' }),
    { kind: 'confine' },
  )
  assert.deepEqual(
    planLaunch({ hasSandbox: true, policyMode: 'workspace-write', choice: 'escalate', platform: 'darwin' }),
    { kind: 'confine' },
  )
})

await test('planLaunch fails closed with actionable guidance on Windows', () => {
  const plan = planLaunch({
    hasSandbox: true,
    policyMode: 'read-only',
    choice: 'fail',
    platform: 'win32',
  })
  assert.equal(plan.kind, 'fail')
  assert.match(plan.reason, /read-only/)
  assert.match(plan.reason, /confinedPolicy/)
  assert.match(plan.reason, /danger-full-access/)
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
    variant: () => ({ status: 'absent', id: 'minimal-gitbash', refs: 0 }),
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
      variant: () => ({ status: 'absent', id: 'minimal-gitbash', refs: 0 }),
    })
    const view = await handlers.discover({ bashPath: inFlight })
    assert.ok(view.candidates.length >= 1)
    assert.equal(pathKey(view.candidates[0].path), pathKey(inFlight))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await test('registerRoutes mounts both routes on the connection service', async () => {
  const registered = []
  const disposed = []
  const scoped = {
    get: (name) =>
      name === 'connection'
        ? {
            fetch: {
              register: (route) => {
                registered.push(route)
                return () => disposed.push(route.path)
              },
            },
          }
        : undefined,
    effect: (callback) => callback(),
  }
  const ctx = { inject: (names, callback) => callback(scoped) }
  registerRoutes(ctx, {
    readSnapshot: () => snapshotConfig({ dialect: { get: () => 'bash' } }),
    capability: () => ({ supported: true }),
    settingsAvailable: () => true,
    lastReplace: () => undefined,
    variant: () => ({ status: 'absent', id: 'minimal-gitbash', refs: 0 }),
  })
  assert.deepEqual(
    registered.map((route) => route.path).sort(),
    ['/api/dsh-terminal-tool/discover', '/api/dsh-terminal-tool/state'],
  )
  for (const route of registered) {
    assert.deepEqual(route.methods, ['POST'])
    assert.equal(route.requestBody, 'buffered')
  }
  // Both are POST-only JSON endpoints that answer 200 even when the handler
  // throws, so the row can show the reason instead of a bare status code.
  const state = registered.find((route) => route.path.endsWith('/state'))
  const response = await state.fetch(
    new Request('http://x/api/dsh-terminal-tool/state', { method: 'POST', body: '{}' }),
  )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.dialect, 'bash')
  assert.equal('candidates' in body, false)
})

await test('registerRoutes degrades when connection is absent', async () => {
  const ctx = { inject: (names, callback) => callback({ get: () => undefined, effect: () => {} }) }
  // Must not throw: a missing service leaves the host half working, and the
  // row reports "settings unavailable" instead of taking the plugin down.
  registerRoutes(ctx, {
    readSnapshot: () => snapshotConfig({}),
    capability: () => ({ supported: false, reason: 'nope' }),
    settingsAvailable: () => false,
    lastReplace: () => undefined,
    variant: () => ({ status: 'absent', id: 'minimal-gitbash', refs: 0 }),
  })
})

/** The shipped `minimal` preset, trimmed to the rows the variant rewrites. */
const MINIMAL_YAML = `- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: You are a helpful software engineer assistant.
    complete: true
    includeRuntimeContext: false
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
  config:
    read: false
    readImage: true
    write: false
    edit: false
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
- id: persistent-shell
  name: cordis:group
  group: true
  isolate:
    terminals: true
  config:
    - id: pty
      name: '@deepseek-ai/dsh-terminal'
    - id: terminal-bash
      name: '@deepseek-ai/dsh-terminal-bash'
      disabled: !!js process.platform === 'win32'
      config:
        timeoutMs: 300000
    - id: persistent-bash
      name: '@deepseek-ai/dsh-tool-bash-persistent'
      disabled: !!js process.platform === 'win32'
      config:
        timeoutMs: 300000
    - id: terminal-pwsh
      name: '@deepseek-ai/dsh-terminal-bash'
      disabled: !!js process.platform !== 'win32'
      config:
        shellDialect: pwsh
        timeoutMs: 300000
    - id: persistent-pwsh
      name: '@deepseek-ai/dsh-tool-pwsh-persistent'
      disabled: !!js process.platform !== 'win32'
      config:
        timeoutMs: 300000
`

/** The concrete inputs one variant registration embeds. */
const VARIANT_SPEC = {
  bashPath: 'C:/Program Files/Git/bin/bash.exe',
  confinedPolicy: 'unconfined',
  loginShell: false,
  pythonUtf8: true,
}

await test('parsePresetRows keeps js expressions instead of dropping them', () => {
  const rows = parsePresetRows(MINIMAL_YAML)
  assert.equal(rows.length, 4)
  const shell = rows.find((row) => row.id === 'persistent-shell')
  assert.equal(shell.group, true)
  assert.deepEqual(shell.isolate, { terminals: true })
  const terminal = shell.config.find((row) => row.id === 'terminal-bash')
  // A schema without the `!!js` tag would either throw or read the expression as
  // a plain string, and the row would then be enabled on both platforms.
  assert.deepEqual(terminal.disabled, { __jsExpr: "process.platform === 'win32'" })
})

await test('preset rows survive a dump/load round trip', () => {
  const rows = parsePresetRows(MINIMAL_YAML)
  assert.deepEqual(parsePresetRows(formatPresetRows(rows)), rows)
})

await test('cloneMinimalForGitBash swaps the Windows terminal for the plugin backend', () => {
  const rows = parsePresetRows(MINIMAL_YAML)
  const cloned = cloneMinimalForGitBash(rows, VARIANT_SPEC)
  const shell = cloned.find((row) => row.id === 'persistent-shell')
  assert.deepEqual(
    shell.config.map((row) => row.id),
    ['pty', 'gitbash-pty', 'terminal-bash', 'persistent-bash'],
  )
  const pty = shell.config.find((row) => row.id === 'gitbash-pty')
  assert.equal(pty.name, 'dsh-terminal-tool/pty')
  assert.equal(pty.config.bashPath, VARIANT_SPEC.bashPath)
  assert.equal(pty.config.backendType, 'gitbash')
  const tool = shell.config.find((row) => row.id === 'persistent-bash')
  // The Windows-side `disabled` must go, and the tool must point at the backend
  // the new row registers.
  assert.equal(tool.disabled, undefined)
  assert.equal(tool.config.backendType, 'gitbash')
  // The POSIX rows stay untouched so the variant is still usable there.
  const posix = shell.config.find((row) => row.id === 'terminal-bash')
  assert.deepEqual(posix.disabled, { __jsExpr: "process.platform === 'win32'" })
})

await test('cloneMinimalForGitBash leaves the source document untouched', () => {
  const rows = parsePresetRows(MINIMAL_YAML)
  const before = JSON.stringify(rows)
  cloneMinimalForGitBash(rows, VARIANT_SPEC)
  assert.equal(JSON.stringify(rows), before)
})

await test('cloneMinimalForGitBash keeps every non-shell row', () => {
  const rows = parsePresetRows(MINIMAL_YAML)
  const cloned = cloneMinimalForGitBash(rows, VARIANT_SPEC)
  assert.deepEqual(
    cloned.map((row) => row.id),
    ['persona', 'tool-fs', 'compaction', 'persistent-shell'],
  )
})

/** A fake context exposing exactly the services the manager probes. */
function variantContext(options = {}) {
  const registered = []
  let broken
  const presets = {
    async register(definition) {
      registered.push(definition)
      return async () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
    },
    async list() {
      return registered.map((definition) => ({
        id: definition.id,
        ...(broken === undefined ? {} : { broken }),
      }))
    },
    async readDocument(id) {
      assert.equal(id, MINIMAL_ID)
      return { content: MINIMAL_YAML }
    },
  }
  const services = {
    agentPresets: presets,
    ...(options.sessions === undefined ? {} : { sessions: { list: () => options.sessions } }),
    ...(options.projections === undefined ? {} : { sessionProjections: options.projections }),
    ...(options.sessionQuery === undefined ? {} : { sessionQuery: options.sessionQuery }),
  }
  return {
    registered,
    setBroken(value) {
      broken = value
    },
    ctx: { get: (name) => services[name] },
  }
}

await test('the variant manager registers a variant and reports it', async () => {
  const fake = variantContext()
  const manager = createVariantManager(fake.ctx)
  const view = await manager.sync('variant', async () => VARIANT_SPEC)
  assert.equal(view.status, 'registered')
  assert.equal(view.id, VARIANT_ID)
  assert.equal(fake.registered.length, 1)
  assert.equal(fake.registered[0].id, VARIANT_ID)
  assert.equal(fake.registered[0].order, 3.1)
  const shell = fake.registered[0].plugins.find((row) => row.id === 'persistent-shell')
  assert.deepEqual(
    shell.config.map((row) => row.id),
    ['pty', 'gitbash-pty', 'terminal-bash', 'persistent-bash'],
  )
})

await test('a broken mount is reported as failed, not as registered', async () => {
  const fake = variantContext()
  const manager = createVariantManager(fake.ctx)
  fake.setBroken('Preset services require isolate realms: terminals')
  await manager.sync('variant', async () => VARIANT_SPEC)
  // `register` never rejects for a broken mount; only the roster knows.
  const view = await manager.verify()
  assert.equal(view.status, 'failed')
  assert.match(view.reason, /isolate realms/)
})

await test('switching the variant off removes it when nothing references it', async () => {
  const fake = variantContext()
  const manager = createVariantManager(fake.ctx)
  await manager.sync('variant', async () => VARIANT_SPEC)
  const view = await manager.sync('oneshot', async () => undefined)
  assert.equal(view.status, 'absent')
  assert.equal(fake.registered.length, 0)
})

await test('a referenced variant is retained, never unregistered', async () => {
  const fake = variantContext({ sessions: [{ header: { agentPreset: VARIANT_ID } }] })
  const manager = createVariantManager(fake.ctx)
  await manager.sync('variant', async () => VARIANT_SPEC)
  const view = await manager.sync('oneshot', async () => undefined)
  // Unregistering would leave that session permanently unopenable: resume
  // resolves the preset id and has no fallback.
  assert.equal(view.status, 'retained')
  assert.equal(view.refs, 1)
  assert.equal(fake.registered.length, 1)
})

await test('the projection, not the header, decides a live reference', async () => {
  const sessions = [{ header: { agentPreset: 'standard' } }]
  const fake = variantContext({ sessions, projections: { stateOf: () => VARIANT_ID } })
  const manager = createVariantManager(fake.ctx)
  await manager.sync('variant', async () => VARIANT_SPEC)
  const view = await manager.sync('leave', async () => undefined)
  assert.equal(view.status, 'retained')
})

await test('persisted sessions also keep the variant alive', async () => {
  const sessionQuery = { listSessions: async () => [{ header: { agentPreset: VARIANT_ID } }] }
  const fake = variantContext({ sessionQuery })
  const manager = createVariantManager(fake.ctx)
  await manager.sync('variant', async () => VARIANT_SPEC)
  const view = await manager.sync('oneshot', async () => undefined)
  assert.equal(view.status, 'retained')
  assert.equal(view.refs, 1)
})

await test('a variant whose Git Bash was not found fails without registering', async () => {
  const fake = variantContext()
  const manager = createVariantManager(fake.ctx)
  const view = await manager.sync('variant', async () => undefined)
  assert.equal(view.status, 'failed')
  assert.match(view.reason, /not found/)
  assert.equal(fake.registered.length, 0)
})

await test('a changed Git Bash path rebuilds the definition', async () => {
  const fake = variantContext()
  const manager = createVariantManager(fake.ctx)
  await manager.sync('variant', async () => VARIANT_SPEC)
  assert.equal(fake.registered.length, 1)

  const moved = { ...VARIANT_SPEC, bashPath: 'D:/PortableGit/bin/bash.exe' }
  await manager.sync('variant', async () => moved)
  // The rows embed the path verbatim, so a stale definition would launch a
  // binary that no longer exists.
  assert.equal(fake.registered.length, 1)
  const shell = fake.registered[0].plugins.find((row) => row.id === 'persistent-shell')
  assert.equal(shell.config.find((row) => row.id === 'gitbash-pty').config.bashPath, moved.bashPath)
})

await test('an unchanged sync does not churn the definition', async () => {
  const fake = variantContext()
  const manager = createVariantManager(fake.ctx)
  await manager.sync('variant', async () => VARIANT_SPEC)
  const first = fake.registered[0]
  await manager.sync('variant', async () => ({ ...VARIANT_SPEC }))
  // Re-registering on every settings write would retire a generation per save.
  assert.equal(fake.registered[0], first)
})

await test('a vanished Git Bash keeps an already usable variant', async () => {
  const fake = variantContext()
  const manager = createVariantManager(fake.ctx)
  await manager.sync('variant', async () => VARIANT_SPEC)
  const view = await manager.sync('variant', async () => undefined)
  assert.equal(view.status, 'registered')
  assert.equal(fake.registered.length, 1)
})

await test('release() drops the definition on teardown', async () => {
  const fake = variantContext()
  const manager = createVariantManager(fake.ctx)
  await manager.sync('variant', async () => VARIANT_SPEC)
  await manager.release()
  assert.equal(fake.registered.length, 0)
  assert.equal(manager.state().status, 'absent')
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
