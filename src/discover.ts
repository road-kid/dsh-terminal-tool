import { execFile } from 'node:child_process'
import { delimiter, dirname, join, resolve } from 'node:path'
import type { BashCandidate } from './shared/protocol.ts'
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
 * Enumerate every candidate a sweep would consider, in priority order.
 *
 * Shared by {@link discoverBash} (which stops at the first usable one, because a
 * session needs exactly one executor) and {@link scanBashCandidates} (which
 * returns all of them, because the settings row's picker lists every choice).
 * Keeping one enumeration means the picker can never offer a path the session
 * would not accept.
 */
async function enumerateCandidates(options: {
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  /**
   * Whether a configured `bashPath` ends the sweep.
   *
   * True for a session (`discoverBash`): an explicitly configured executable is
   * the answer, and scanning the machine anyway would be wasted work on every
   * agent creation. False for the settings row's picker (`scanBashCandidates`):
   * the user asked to see every Git Bash, so a saved path is just the first
   * candidate rather than the end of the search.
   */
  readonly explicitWins: boolean
}): Promise<{ ordered: Candidate[]; rejected: { path: string; reason: string }[] }> {
  const rejected: { path: string; reason: string }[] = []
  const seen = new Set<string>()

  /** Push a candidate, dropping duplicates and every WSL launcher. */
  const push = (candidate: Candidate): void => {
    const key = candidate.path.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    if (isWslBash(candidate.path)) {
      rejected.push({ path: candidate.path, reason: 'WSL launcher, not Git Bash' })
      return
    }
    ordered.push(candidate)
  }

  const ordered: Candidate[] = []

  // 1. An explicit executable wins for a session, even when discovery is off.
  const explicit = options.bashPath.trim()
  if (explicit !== '') {
    push({ path: explicit, source: 'configured' })
  }

  if (options.autoDiscover && !(options.explicitWins && explicit !== '')) {
    // 2. Explicit candidate list: executables, bin directories or install roots.
    for (const item of options.bashCandidates) {
      if (item.trim() === '') continue
      for (const candidate of expand({ path: item, source: 'candidate' })) push(candidate)
    }

    const controller = new AbortController()
    const timer =
      options.timeoutMs > 0
        ? setTimeout(() => {
            controller.abort(new Error('discovery timeout'))
          }, options.timeoutMs)
        : undefined
    const signal =
      options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal])

    try {
      // 3. Registry-reported Git installation.
      const registry = await registryInstallPath(signal)
      if (registry !== undefined && !signal.aborted) {
        for (const candidate of expand({ path: registry, source: 'registry' })) push(candidate)
      }

      // 4-6. Conventional locations and PATH.
      for (const root of environmentRoots()) {
        for (const candidate of expand(root)) push(candidate)
      }
      const fromPath = bashFromGitOnPath()
      if (fromPath !== undefined) push(fromPath)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  // Only paths that really are a usable bash survive; the rest keep a reason.
  const usable: Candidate[] = []
  for (const candidate of ordered) {
    const verdict = validateBashPath(candidate.path)
    if (verdict.ok) usable.push(candidate)
    else rejected.push({ path: candidate.path, reason: verdict.reason })
  }
  return { ordered: usable, rejected }
}

/**
 * Scan every usable Git Bash on this machine, for the settings row's picker.
 *
 * Unlike {@link discoverBash} this never stops at the first hit: the user gets
 * the full list, ordered by source priority. `saved` is put first so the value
 * the user already chose stays selectable even when the sweep would rank it
 * lower.
 */
export async function scanBashCandidates(options: {
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}): Promise<BashCandidate[]> {
  const { ordered } = await enumerateCandidates({ ...options, explicitWins: false })
  const rank = (candidate: Candidate): number => (candidate.source === 'configured' ? 0 : 1)
  const sorted = [...ordered].sort((left, right) => {
    const byRank = rank(left) - rank(right)
    if (byRank !== 0) return byRank
    return left.path.localeCompare(right.path, 'en')
  })
  return sorted.map((candidate) => ({ path: candidate.path, source: candidate.source, valid: true }))
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
  const { ordered, rejected } = await enumerateCandidates({ ...options, explicitWins: true })
  const considered = ordered.map((candidate) => candidate.path)
  const found = ordered[0]
  if (found === undefined) return { found: undefined, considered, rejected }
  return { found: { path: found.path, source: found.source }, considered, rejected }
}
