/**
 * Persistent-terminal backend check (`lib/pty.js`, the `./pty` entry point).
 *
 * The variant preset rows replace the official PowerShell pair with this
 * backend, so the properties that matter are: the entry registers exactly one
 * backend under the configured type, a `unconfined` launch really starts Git
 * Bash inside a ConPTY and keeps shell state across two sends, and the two
 * stricter policies refuse instead of silently bypassing the sandbox.
 *
 * Runs the real `dsh-subprocess-local` / `dsh-sandbox-local` /
 * `dsh-sandbox-policy` / `dsh-terminal` stack. Win32 + Git Bash only; other
 * hosts report a skip so `npm run check` stays usable everywhere.
 *
 * Run with `npm run ptytests` after `npm run build`.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

import { Context, Service } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TerminalService from '@deepseek-ai/dsh-terminal'

import * as pty from '../lib/pty.js'

const BASH = 'C:/Program Files/Git/bin/bash.exe'
const available = process.platform === 'win32' && existsSync(BASH)

let passed = 0
let failed = 0
let skipped = 0

async function test(name, body) {
  if (!available) {
    skipped += 1
    process.stdout.write(`skip ${name}\n`)
    return
  }
  try {
    await body()
    passed += 1
    process.stdout.write(`ok   ${name}\n`)
  } catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`FAIL ${name}\n     ${message}\n`)
  }
}

const waitReady = () => new Promise((resolve) => setTimeout(resolve, 200))

/** `TerminalSessionService` spawns only for owners its `agents` registry knows. */
class AgentsStub extends Service {
  constructor(ctx) {
    super(ctx, 'agents')
    this.known = new Map()
  }

  get(id) {
    return this.known.get(String(id))
  }

  add(owner) {
    this.known.set(String(owner.id), owner)
  }
}

class WorkingDirectoryStub extends Service {
  constructor(ctx) {
    super(ctx, 'workingDirectory')
  }

  async ensure() {
    return process.cwd()
  }
}

/**
 * Mount the real stack for one sandbox mode and register the `/pty` entry.
 * The backend instance is captured by wrapping `registerBackend` *before* the
 * entry loads: `terminals.spawn()` only returns a snapshot, and the test needs
 * the session handle to drive two commands.
 */
async function mount(mode, policy) {
  const ctx = new Context()
  ctx.plugin(SubprocessLocal)
  ctx.plugin(SandboxLocal)
  ctx.plugin(SessionProjectionRegistry)
  ctx.plugin(TerminalService)
  ctx.plugin(SandboxPolicyService, { mode })
  ctx.plugin(WorkingDirectoryStub)
  ctx.plugin(AgentsStub)
  await waitReady()

  const terminals = ctx.get('terminals')
  let captured
  const register = terminals.registerBackend.bind(terminals)
  terminals.registerBackend = (backend) => {
    captured = backend
    return register(backend)
  }
  ctx.plugin(pty, { backendType: 'gitbash', bashPath: BASH, confinedPolicy: policy })
  await waitReady()
  return { ctx, terminals, backend: () => captured }
}

/** A session stand-in with the two members the projection service folds. */
function makeOwner(ctx) {
  const presetKey = { preset: 'pty-test' }
  const preset = createScope(ctx, presetKey)
  const session = {
    id: 'pty-test',
    header: { id: 'pty-test', cwd: process.cwd() },
    inheritedEventCount: 0,
    seq: 0,
    snapshotEvents: () => [],
    eventAt: () => undefined,
  }
  const owner = { id: 'pty-test', session }
  const scope = createScope(ctx, owner, { parent: presetKey })
  owner.ctx = scope.ctx
  ctx.get('agents').add(owner)
  return { owner, preset, scope }
}

await test('the entry registers exactly one backend under its configured type', async () => {
  const { ctx, terminals, backend } = await mount('danger-full-access', 'unconfined')
  assert.deepEqual(terminals.listBackends(), ['gitbash'])
  assert.equal(backend()?.type, 'gitbash', 'the entry must register the backend it configures')
  await ctx.fiber.dispose()
})

await test('unconfined starts Git Bash and keeps state across two sends', async () => {
  const { ctx, backend } = await mount('workspace-write', 'unconfined')
  const { owner, preset, scope } = makeOwner(ctx)
  const session = await backend().spawn({ type: 'gitbash', name: 'acceptance', owner })

  async function run(command) {
    const operation = session.startSend({ text: command, submit: true })
    return (await operation.done).viewport
  }

  const first = await run('export DSH_PTY_MARK=persistent-ok; echo "ready-$DSH_PTY_MARK"')
  assert.match(first, /ready-persistent-ok/, 'the command must run inside the PTY')
  const second = await run('echo "second-$DSH_PTY_MARK"')
  assert.match(second, /second-persistent-ok/, 'shell state must survive between sends')

  await session.close()
  await scope.dispose()
  await preset.dispose()
  await ctx.fiber.dispose()
})

await test('fail refuses with SANDBOX_UNAVAILABLE instead of launching', async () => {
  const { ctx, backend } = await mount('workspace-write', 'fail')
  const { owner, preset, scope } = makeOwner(ctx)
  let error
  try {
    await backend().spawn({ type: 'gitbash', name: 'acceptance', owner })
  } catch (thrown) {
    error = thrown
  }
  assert.ok(error, 'a fail policy must not spawn')
  assert.equal(error.code, 'SANDBOX_UNAVAILABLE')
  await preset.dispose()
  await ctx.fiber.dispose()
})

await test('escalate goes through the sandbox and fails where MSYS cannot start', async () => {
  const { ctx, backend } = await mount('workspace-write', 'escalate')
  const { owner, preset } = makeOwner(ctx)
  let error
  try {
    await backend().spawn({ type: 'gitbash', name: 'acceptance', owner })
  } catch (thrown) {
    error = thrown
  }
  // The persistent backend has no `sandbox_permissions` retry channel, so the
  // confined launch is the end of the road rather than an escalation prompt.
  assert.ok(error, 'escalate must not silently fall back to a direct launch')
  assert.match(String(error.message), /exited during startup|MSYS|0xC0000/i)
  await preset.dispose()
  await ctx.fiber.dispose()
})

process.stdout.write(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`)
// ConPTY keeps a native handle alive after every session closes, so the event
// loop never drains on its own; exit explicitly once the report is out.
process.exit(failed > 0 ? 1 : 0)
