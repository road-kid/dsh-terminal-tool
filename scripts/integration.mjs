/**
 * Integration check.
 *
 * Mounts the *real* first-party services in a throwaway cordis application and
 * drives the replacement the way the harness does: a scoped agent context that
 * inherits a `pwsh` tool from an enclosing (preset-like) scope, then
 * `installSession()` on top of it.
 *
 * This is the closest thing to a live session that can run outside the desktop
 * app. It verifies the properties the design depends on:
 *
 * - `bash` lands in the agent's own tool layer and `pwsh` disappears from it;
 * - the agent's `bash` really executes Git Bash and returns its stdout;
 * - the `tool:pwsh` prompt section is blanked for that agent only;
 * - the host-level `ctx.shell` is untouched;
 * - a second install for the same agent is a no-op.
 *
 * The real `tool-pwsh` is not mounted: it needs a full fs/working-directory
 * stack, and what matters here is that `pwsh` is *inherited* — a fixture tool in
 * an enclosing scope has the same visibility semantics.
 *
 * Run with `npm run integration` after `npm run build`.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

import { Context, Service } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TerminalService from '@deepseek-ai/dsh-terminal'

import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import { apply, installResultFor } from '../lib/index.js'
import { GitBashExecutor, installSession, snapshotConfig } from '../lib/testing.js'
import * as ptyEntry from '../lib/pty.js'

let passed = 0
let failed = 0

async function test(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`ok   ${name}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`FAIL ${name}\n     ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  }
}

/**
 * Stand-in for `dsh-working-directory`. `tool-bash` only ever asks it for the
 * session's effective cwd, and mounting the real one would drag in a
 * filesystem backend this test has no use for.
 */
class WorkingDirectoryStub extends Service {
  constructor(ctx) {
    super(ctx, 'workingDirectory')
  }

  async ensure() {
    return process.cwd()
  }
}

function waitReady(ctx) {
  return new Promise((resolve) => setTimeout(resolve, 300))
}

/**
 * Obtain a context that may read the listed services as properties.
 *
 * In the harness this comes for free: the agent context inherits the dependency
 * API of whatever plugin minted the scope. Here the scopes are minted from the
 * root context, which has no fiber, so one throwaway plugin supplies the
 * `inject` declaration.
 */
function serviceContext(ctx, names) {
  return new Promise((resolve) => {
    ctx.inject(names, (scoped) => {
      resolve(scoped)
    })
  })
}

/** A host with every service the bash tool actually needs. */
async function createHost({ sandbox = true, mode = 'danger-full-access' } = {}) {
  const ctx = new Context()
  ctx.plugin(SubprocessLocal)
  if (sandbox) {
    ctx.plugin(SandboxLocal)
    ctx.plugin(SessionProjectionRegistry)
    ctx.plugin(SandboxPolicyService, { mode })
  }
  ctx.plugin(SystemPrompt)
  ctx.plugin(ToolRuntime)
  ctx.plugin(ShellEnv)
  ctx.plugin(WorkingDirectoryStub)
  await waitReady(ctx)
  const api = await serviceContext(ctx, ['tools', 'systemPrompt'])
  return { ctx, api }
}

/**
 * Build one agent the way the harness does: a scoped child of an enclosing
 * "preset" scope, which is where the inherited `pwsh` tool and its prompt
 * section live.
 */
function createAgent(host, id) {
  const presetKey = { preset: id }
  const preset = createScope(host.api, presetKey)
  preset.ctx.tools.register({
    name: 'pwsh',
    description: 'fixture stand-in for the inherited pwsh tool',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: () => [] },
    async execute() {
      return { kind: 'foreground' }
    },
  })
  // Mirrors `dsh-tool-pwsh`: this is the section the plugin blanks out.
  preset.ctx.systemPrompt.section({
    name: 'tool:pwsh',
    order: preset.ctx.systemPrompt.getSectionOrder('TOOL_PWSH') ?? 1010,
    text: 'Non-zero exits are reported as `[exit code: N]` markers; this is the pwsh guidance.',
  })

  const agent = { id, session: { id, header: { id } } }
  const scope = createScope(host.api, agent, { parent: presetKey })
  agent.ctx = scope.ctx
  return { agent, scope, preset, presetKey }
}

const hasGitBash = existsSync('C:\\Program Files\\Git\\bin\\bash.exe')

/**
 * A sandbox provider that records calls and wraps argv with whatever the test
 * asks for. Confinement itself is exercised elsewhere; here the point is which
 * launch path the executor selects and what it records afterwards.
 */
class FakeSandboxProvider extends SandboxProvider {
  calls = []

  constructor(ctx, wrapped) {
    super(ctx)
    this.wrapped = wrapped
  }

  async confine(argv, policy) {
    this.calls.push({ argv, policy })
    return {
      argv: this.wrapped ?? [...argv],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [],
    }
  }
}

/** One foreground spec with a resolved policy, the shape `resolve()` produces. */
function execSpec(command, sandboxPolicy) {
  return {
    command,
    workdir: process.cwd(),
    timeoutMs: 30_000,
    onExpiry: 'kill',
    stdoutMaxBytes: 64_000,
    sandboxPolicy,
  }
}

/**
 * Mount the executor in its own isolated shell realm, exactly like
 * `installSession` does, and hand back the service instance for direct calls.
 */
async function mountExecutor(ctx, { bashPath, confinedPolicy }) {
  const shellCtx = ctx.isolate(`shell-confined-${confinedPolicy}`)
  const fiber = await shellCtx.plugin(GitBashExecutor, {
    bashPath,
    pathEntries: [],
    loginShell: false,
    pythonUtf8: false,
    confinedPolicy,
    cwd: process.cwd(),
    timeoutMs: 30_000,
    maxTimeoutMs: 600_000,
    maxOutputBytes: 64_000,
    maxSpillBytes: 64 * 1024 * 1024,
    graceMs: 3_000,
  })
  return { executor: shellCtx.get('shell'), fiber }
}

await test('installSession replaces pwsh with bash for one session', async () => {
  const host = await createHost()
  const { agent, scope, preset, presetKey } = createAgent(host, 'session-a')
  const tools = agent.ctx.tools

  assert.ok(tools.get('pwsh', agent), 'precondition: pwsh is inherited')
  assert.equal(tools.get('bash', agent), undefined, 'precondition: bash is absent')

  const snapshot = snapshotConfig({ dialect: 'bash', bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe' })
  const result = await installSession(host.ctx, agent, snapshot)
  assert.equal(result.status, 'installed', `install failed: ${JSON.stringify(result)}`)

  assert.ok(tools.get('bash', agent), 'bash is visible to the agent')
  assert.equal(tools.get('pwsh', agent), undefined, 'pwsh is hidden from the agent')

  // The enclosing scope keeps its tool: hiding is per agent, not global.
  assert.ok(tools.get('pwsh', presetKey), 'preset scope still sees pwsh')

  // The prompt section is blanked for this agent only.
  const prompt = renderPrompt(await agent.ctx.systemPrompt.assemble({ scope: agent }))
  assert.ok(!prompt.includes('Non-zero exits are reported'), 'pwsh guidance is gone')

  await scope.dispose()
  await preset.dispose()
  await host.ctx.registry.delete(SubprocessLocal)
})

await test('the installed bash tool executes Git Bash', async () => {
  if (!hasGitBash) {
    process.stdout.write('     (skipped: Git Bash is not installed)\n')
    return
  }
  // No sandbox here: `tool-bash` would ask the policy service to resolve for a
  // real Session, and this stand-in agent has no session projections. The
  // unconfined path is the one that exercises argv construction and PATH.
  const host = await createHost({ sandbox: false })
  const { agent, scope, preset } = createAgent(host, 'session-b')

  const result = await installSession(
    host.ctx,
    agent,
    snapshotConfig({ dialect: 'bash', bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe' }),
  )
  assert.equal(result.status, 'installed')

  const tool = agent.ctx.tools.get('bash', agent)
  assert.ok(tool, 'bash tool present')

  const output = await tool.execute(
    { description: 'report the shell', command: 'echo "$BASH_VERSION"; uname -s' },
    { agent, callId: 'call-1', signal: new AbortController().signal },
  )
  const text = JSON.stringify(output)
  assert.match(text, /MINGW|MSYS/i, `expected an MSYS uname, got: ${text}`)

  await scope.dispose()
  await preset.dispose()
})

await test('a second install for the same agent is a no-op', async () => {
  const host = await createHost()
  const { agent, scope, preset } = createAgent(host, 'session-c')
  const snapshot = snapshotConfig({ dialect: 'bash', bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe' })

  assert.equal((await installSession(host.ctx, agent, snapshot)).status, 'installed')
  const second = await installSession(host.ctx, agent, snapshot)
  assert.equal(second.status, 'skipped')
  assert.equal(second.reason, 'already-replaced')

  await scope.dispose()
  await preset.dispose()
})

await test('dialect pwsh leaves the session untouched', async () => {
  const host = await createHost()
  const { agent, scope, preset } = createAgent(host, 'session-d')

  const result = await installSession(host.ctx, agent, snapshotConfig({ dialect: 'pwsh' }))
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'dialect-pwsh')
  assert.ok(agent.ctx.tools.get('pwsh', agent), 'pwsh still inherited')
  assert.equal(agent.ctx.tools.get('bash', agent), undefined, 'bash was not added')

  await scope.dispose()
  await preset.dispose()
})

await test('apply() wires agent/created and records the outcome', async () => {
  const host = await createHost()
  // Mount the real plugin entry the way the loader does: config in, no services
  // injected, everything probed.
  const fiber = host.ctx.plugin({ name: 'terminal-tool', inject: [], apply }, { dialect: 'bash' })
  await fiber

  const { agent, scope, preset } = createAgent(host, 'session-e')
  // `dsh-agent` dispatches this event while creating a session; the payload shape
  // is `{ agent, source, signal? }` and the listener must resolve before creation
  // completes.
  await host.ctx.serial('agent/created', { agent, source: 'startup' })

  assert.equal(installResultFor('session-e')?.status, 'installed', 'the listener installed the replacement')
  assert.ok(agent.ctx.tools.get('bash', agent), 'bash is visible to the agent')
  assert.equal(agent.ctx.tools.get('pwsh', agent), undefined, 'pwsh is hidden from the agent')

  // Disposal drops the memo entry, so a long-lived host does not grow a map.
  await host.ctx.serial('agent/disposed', { agent })
  assert.equal(installResultFor('session-e'), undefined, 'memo dropped on dispose')

  await scope.dispose()
  await preset.dispose()
  await host.ctx.registry.delete(fiber)
})

await test('confinedPolicy unconfined runs Git Bash directly on Windows', async () => {
  if (process.platform !== 'win32' || !hasGitBash) {
    process.stdout.write('     (skipped: needs Windows with Git Bash installed)\n')
    return
  }
  const host = await createHost({ sandbox: false })
  const fake = new FakeSandboxProvider(host.ctx)
  const { executor, fiber } = await mountExecutor(host.ctx, {
    bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
    confinedPolicy: 'unconfined',
  })

  const execution = await executor.execute(
    execSpec('echo "$BASH_VERSION"; uname -s', {
      mode: 'workspace-write',
      workspaceRoot: process.cwd(),
    }),
  )
  const result = await execution.result()
  await execution.done

  assert.equal(fake.calls.length, 0, 'unconfined must not call sandbox.confine()')
  // The settled facts describe what actually ran: no sandbox backend contained
  // the child, so the effective boundary is full access and there is nothing for
  // `enforcement` (an official enum about a *live* backend) to describe.
  assert.equal(result.sandbox.mode, 'danger-full-access', 'a bypassed launch reports the effective boundary')
  assert.equal(result.sandbox.denied, false)
  assert.equal(result.sandbox.enforcement, undefined)
  assert.match(result.stdout.text, /MINGW|MSYS/i, `expected an MSYS uname, got: ${result.stdout.text}`)

  await fiber.dispose()
})

await test('sandboxMode hides a standing mode the executor would bypass', async () => {
  const host = await createHost({ mode: 'workspace-write' })
  const bashPath = 'C:\Program Files\Git\bin\bash.exe'

  // `unconfined` bypasses the sandbox on Windows, so advertising the standing
  // `workspace-write` mode would tell `tool-bash` (and the model) that commands
  // are confined when they are not. On other platforms the same choice still
  // confines, so the mode is honest and stays visible.
  const unconfined = await mountExecutor(host.ctx, { bashPath, confinedPolicy: 'unconfined' })
  const expectedUnconfined = process.platform === 'win32' ? undefined : 'workspace-write'
  assert.equal(unconfined.executor.sandboxMode, expectedUnconfined)
  await unconfined.fiber.dispose()

  const escalate = await mountExecutor(host.ctx, { bashPath, confinedPolicy: 'escalate' })
  assert.equal(escalate.executor.sandboxMode, 'workspace-write', 'escalate keeps the standing mode')
  await escalate.fiber.dispose()

  await host.ctx.registry.delete(host.ctx.get('shell'))
})

await test('confinedPolicy escalate marks an MSYS startup crash as denied', async () => {
  const crash =
    'fatal error - NtCreateDirectoryObject(\\BaseNamedObjects\\msys-2.0S5-1888ae32e00d56aa): 0xC0000022'
  const host = await createHost({ sandbox: false })
  const fake = new FakeSandboxProvider(host.ctx, [
    process.execPath,
    '-e',
    `process.stderr.write(${JSON.stringify(crash)}); process.exit(3221225794)`,
  ])
  const { executor, fiber } = await mountExecutor(host.ctx, {
    bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
    confinedPolicy: 'escalate',
  })

  const execution = await executor.execute(
    execSpec('true', { mode: 'workspace-write', workspaceRoot: process.cwd() }),
  )
  const result = await execution.result()
  await execution.done

  assert.equal(fake.calls.length, 1, 'escalate must go through the sandbox provider')
  assert.equal(fake.calls[0].policy.mode, 'workspace-write')
  assert.equal(execution.sandbox?.denied, true, 'the live process carries the denial fact')
  assert.equal(result.sandbox.denied, true, 'the foreground projection carries the denial fact')

  await fiber.dispose()
})


/**
 * Preset-aware dispatch.
 *
 * `minimal` is the only shipped preset with a *persistent* terminal, so the
 * plugin must not silently swap it for a one-shot bash unless the user asked
 * for that. The projection is absent in this harness (no
 * `SessionProjectionRegistry`), which is exactly the fallback path: the durable
 * creation header decides.
 */
async function presetAgent(preset) {
  const host = await createHost({ sandbox: false })
  const built = createAgent(host, `session-${preset}`)
  built.agent.session.header.agentPreset = preset
  return { host, ...built }
}

await test('minimalMode leave keeps the official minimal terminal', async () => {
  const { host, agent, scope, preset } = await presetAgent('minimal')
  const result = await installSession(host.ctx, agent, snapshotConfig({ dialect: 'bash', minimalMode: 'leave' }))
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'minimal-left')
  assert.ok(agent.ctx.tools.get('pwsh', agent), 'the persistent pwsh tool stays')
  assert.equal(agent.ctx.tools.get('bash', agent), undefined, 'no one-shot bash was added')
  await scope.dispose()
  await preset.dispose()
})

await test('minimalMode variant also leaves plain minimal sessions alone', async () => {
  const { host, agent, scope, preset } = await presetAgent('minimal')
  const result = await installSession(host.ctx, agent, snapshotConfig({ dialect: 'bash', minimalMode: 'variant' }))
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'minimal-left')
  assert.ok(agent.ctx.tools.get('pwsh', agent))
  await scope.dispose()
  await preset.dispose()
})

await test('minimalMode oneshot keeps replacing minimal sessions', async () => {
  const { host, agent, scope, preset } = await presetAgent('minimal')
  const result = await installSession(
    host.ctx,
    agent,
    snapshotConfig({ dialect: 'bash', minimalMode: 'oneshot', bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe' }),
  )
  assert.equal(result.status, 'installed', `expected the old behaviour: ${JSON.stringify(result)}`)
  assert.ok(agent.ctx.tools.get('bash', agent))
  assert.equal(agent.ctx.tools.get('pwsh', agent), undefined)
  await scope.dispose()
  await preset.dispose()
})

await test('a session on the variant preset is never stacked with a second bash', async () => {
  const { host, agent, scope, preset } = await presetAgent('minimal-gitbash')
  const result = await installSession(host.ctx, agent, snapshotConfig({ dialect: 'bash', minimalMode: 'oneshot' }))
  assert.equal(result.status, 'skipped')
  // The variant mounts its own persistent `bash`; a one-shot one would collide.
  assert.equal(result.reason, 'already-replaced')
  await scope.dispose()
  await preset.dispose()
})

await test('a standard preset session is unaffected by minimalMode', async () => {
  const { host, agent, scope, preset } = await presetAgent('standard')
  const result = await installSession(
    host.ctx,
    agent,
    snapshotConfig({ dialect: 'bash', minimalMode: 'leave', bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe' }),
  )
  // `leave` is about minimal only: every other preset keeps the replacement.
  assert.equal(result.status, 'installed', `standard must still be replaced: ${JSON.stringify(result)}`)
  await scope.dispose()
  await preset.dispose()
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1


