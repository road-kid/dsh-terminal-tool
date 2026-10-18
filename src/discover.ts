import { execFile } from 'node:child_process'
import { delimiter, dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { DiscoveredBash, DiscoveryReport, DiscoverySource } from './types.ts'
import { candidateExecutables, isFile, isWslBash, validateBashPath } from './paths.ts'

/**
 * Bash discovery.
 *
 * Shelling out to `where bash` and `bash --version` is the wrong shape for a
 * host that boots agents in a serial event: a synchronous spawn stalls the whole
 * process, and running an untrusted executable just to find out whether it is
 * bash is a poor trade. Discovery here is filesystem-only — it stats candidate
 * paths — with two exceptions that are cheap and safe: reading the Git for
 * Windows install location from the registry (`reg.exe query`, asynchronous,
 * hard timeout) and deriving a root from `git.exe` already on PATH.
 *
 * WSL is excluded at every step: the Windows `bash.exe` is a WSL launcher, and
 * handing it to the executor yields a different filesystem and OS entirely (F7).
 */

interface Candidate {
  readonly path: string
  readonly source: DiscoverySource
}

/** Read `HKLM\SOFTWARE\GitForWindows` `InstallPath`, if present. */
async function registryInstallPath(signal: AbortSignal): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined
  const output = await new Promise<string | undefined>((done) => {
    // `reg.exe` is a native Windows binary; it is cheap (~15ms) and this is the
    // only way to learn where Git was installed without reading hives by hand.
    execFile(
      'reg.exe',
      ['query', 'HKLM\\SOFTWARE\\GitForWindows', '/v', 'InstallPath'],
      { encoding: 'utf8', timeout: 1000, windowsHide: true, signal },
      (error, stdout) => {
        if (error !== null) done(undefined)
        else done(stdout)
      },
    )
  })
  if (output === undefined) return undefined
  // "    InstallPath    REG_SZ    C:\Program Files\Git"
  const match = /InstallPath\s+REG_[A-Z_]+\s+(.+?)\s*$/im.exec(output)
  return match?.[1]?.trim()
}

/** Environment-derived installation roots, in order. */
function environmentRoots(): Candidate[] {
  const roots: Candidate[] = []
  const push = (root: string | undefined, source: DiscoverySource): void => {
    if (root === undefined || root.trim() === '') return
    roots.push({ path: resolve(root), source })
  }

  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env.LOCALAPPDATA
  const systemDrive = process.env.SystemDrive ?? 'C:'

  push(programFiles === undefined ? undefined : join(programFiles, 'Git'), 'program-files')
  push(programFilesX86 === undefined ? undefined : join(programFilesX86, 'Git'), 'program-files')
  push(localAppData === undefined ? undefined : join(localAppData, 'Programs', 'Git'), 'program-files')

  push(programFiles === undefined ? undefined : join(programFiles, 'MSYS2'), 'msys2')
  push(join(systemDrive, 'msys64'), 'msys2')
  push(localAppData === undefined ? undefined : join(localAppData, 'MSYS2'), 'msys2')

  push(join(systemDrive, 'cygwin64'), 'cygwin')
  push(join(systemDrive, 'cygwin'), 'cygwin')
  return roots
}

/**
 * Derive a bash executable from a `git.exe` found on PATH.
 *
 * Git for Windows always ships `<root>\bin\bash.exe` next to the `cmd\git.exe`
 * that gets put on PATH, so resolving `git` is a reliable last resort when the
 * install directory is non-standard (portable Git, Scoop, Chocolatey).
 */
function bashFromGitOnPath(): Candidate | undefined {
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  for (const entry of pathValue.split(delimiter)) {
    const trimmed = entry.trim()
    if (trimmed === '') continue
    for (const name of ['git.exe', 'git.cmd', 'git.bat']) {
      const git = join(trimmed, name)
      if (!isFile(git)) continue
      const root = resolve(dirname(git), '..')
      for (const suffix of [join('bin', 'bash.exe'), join('usr', 'bin', 'bash.exe')]) {
        const bash = join(root, suffix)
        if (isFile(bash)) return { path: bash, source: 'path' }
      }
    }
  }
  return undefined
}

/** Turn a candidate root or executable into every bash executable it implies. */
function expand(candidate: Candidate): Candidate[] {
  return candidateExecutables(candidate.path).map((path) => ({ path, source: candidate.source }))
}

/**
 * Run one discovery sweep.
 *
 * The sweep is bounded by `timeoutMs`; on timeout the candidates considered so
 * far are returned. Every rejection is recorded with a reason so the diagnostic
 * log explains *why* bash was not found instead of merely reporting that it was
 * not — the common failure (`where bash` finding WSL) is otherwise invisible.
 */
export async function discoverBash(options: {
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}): Promise<DiscoveryReport> {
  const considered: string[] = []
  const rejected: { path: string; reason: string }[] = []

  const accept = (path: string): boolean => {
    const verdict = validateBashPath(path)
    if (verdict.ok) return true
    if (!considered.includes(path) && verdict.reason !== 'file does not exist') {
      rejected.push({ path, reason: verdict.reason })
    }
    return false
  }

  // 1. An explicit executable always wins, even when discovery is disabled.
  const explicit = options.bashPath.trim()
  if (explicit !== '') {
    considered.push(explicit)
    if (accept(explicit)) return { found: { path: explicit, source: 'configured' }, considered, rejected }
  }

  if (!options.autoDiscover) {
    if (explicit !== '') rejected.push({ path: explicit, reason: 'configured path is not a usable bash' })
    return { found: undefined, considered, rejected }
  }

  const controller = new AbortController()
  const timer =
    options.timeoutMs > 0
      ? setTimeout(() => {
          controller.abort(new Error('discovery timeout'))
        }, options.timeoutMs)
      : undefined
  const signal = options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal])

  try {
    const ordered: Candidate[] = []

    // 2. Explicit candidate list: executables, bin directories or install roots.
    for (const item of options.bashCandidates) {
      if (item.trim() === '') continue
      ordered.push(...expand({ path: item, source: 'candidate' }))
    }

    // 3. Registry-reported Git installation.
    const registry = await registryInstallPath(signal)
    if (registry !== undefined && !signal.aborted) {
      ordered.push(...expand({ path: registry, source: 'registry' }))
    }

    // 4-6. Conventional locations and PATH.
    for (const root of environmentRoots()) ordered.push(...expand(root))
    const fromPath = bashFromGitOnPath()
    if (fromPath !== undefined) ordered.push(fromPath)

    for (const candidate of ordered) {
      if (signal.aborted) break
      if (considered.includes(candidate.path)) continue
      considered.push(candidate.path)
      if (isWslBash(candidate.path)) {
        rejected.push({ path: candidate.path, reason: 'WSL launcher, not Git Bash' })
        continue
      }
      if (!existsSync(candidate.path)) continue
      if (accept(candidate.path)) return { found: { path: candidate.path, source: candidate.source }, considered, rejected }
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  return { found: undefined, considered, rejected }
}
