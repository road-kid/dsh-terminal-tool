import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'

/**
 * Path arithmetic for a bash installation.
 *
 * Git for Windows ships bash at `<root>\bin\bash.exe` (a small launcher) and
 * `<root>\usr\bin\bash.exe` (the real MSYS2 binary; `bin` re-execs it). Either
 * works, but the surrounding tools (`git`, `ls`, `grep`, `sed`, `make`) only
 * resolve when the matching `bin`/`usr\bin` directories are on PATH, and the
 * toolchain (`gcc`, `cmake`) only when the environment-specific directory is.
 */

/** Normalize a path for comparison: separators, case, trailing separator. */
export function pathKey(path: string): string {
  let key = path.replace(/\//g, '\\').replace(/\\+$/, '')
  if (key === '') key = '\\'
  // Windows path comparison is case-insensitive; drive letters and directories.
  return key.toLowerCase()
}

/** Whether two paths point at the same place, by the rules above. */
export function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

/** Whether `path` is an existing regular file. */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Whether `path` is an existing directory. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Derive the installation root from a bash executable.
 *
 * - `<root>\bin\bash.exe` → `<root>`
 * - `<root>\usr\bin\bash.exe` → `<root>` (two levels, because MSYS2 nests `usr`)
 * - anything else → the executable's directory
 */
export function bashInstallRoot(bashPath: string): string {
  const absolute = resolve(bashPath)
  const directory = dirname(absolute)
  if (samePath(directory, join(installRootGuess(directory), 'bin'))) return installRootGuess(directory)
  if (samePath(directory, join(installRootGuess(directory), 'usr', 'bin'))) return installRootGuess(directory)
  return directory
}

/** The root candidate implied by a directory that may be `<root>`, `<root>\bin` or `<root>\usr\bin`. */
function installRootGuess(directory: string): string {
  const leaf = directory.substring(directory.lastIndexOf(sep) + 1).toLowerCase()
  if (leaf === 'bin') {
    const parent = dirname(directory)
    const parentLeaf = parent.substring(parent.lastIndexOf(sep) + 1).toLowerCase()
    if (parentLeaf === 'usr') return dirname(parent)
    return parent
  }
  return directory
}

/**
 * Build the PATH entries for one installation.
 *
 * Only directories that actually exist are returned, in the order MSYS2 itself
 * expects: the environment-specific toolchain first, then `usr\bin`, then
 * `bin`... except that `usr\bin` must precede `bin` so the real MSYS2 tools win
 * over the thin launchers.
 */
export function bashPathEntries(root: string, extra: readonly string[] = []): string[] {
  const entries: string[] = []
  const push = (candidate: string): void => {
    if (candidate !== '' && isDirectory(candidate)) entries.push(candidate)
  }

  for (const name of ['ucrt64', 'mingw64', 'clang64', 'mingw32']) {
    push(join(root, name, 'bin'))
  }
  push(join(root, 'usr', 'bin'))
  push(join(root, 'bin'))
  push(join(root, 'usr', 'local', 'bin'))
  for (const item of extra) push(item)

  return dedupe(entries)
}

/** Drop duplicate paths while keeping the first occurrence. */
export function dedupe(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    const normalized = normalize(entry)
    const key = pathKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

/**
 * Compose the child PATH: the plugin's own entries first, then the host PATH.
 *
 * Ordering matters twice over: MSYS2 tools must win over anything Windows
 * happens to expose, and the host PATH must survive so that native Windows
 * executables the user expects (`git`, `node`, `python`) keep working.
 */
export function composePath(entries: readonly string[], hostPath: string | undefined): string {
  const parts = [...entries]
  for (const part of (hostPath ?? '').split(';')) {
    if (part.trim() !== '') parts.push(part)
  }
  return dedupe(parts).join(';')
}

/**
 * Validate a candidate bash executable.
 *
 * Discovery is intentionally strict about one thing: the Windows system
 * `bash.exe` is the WSL launcher, not Git Bash. Handing it to the executor
 * produces `Wsl/Service/CreateInstance/...` failures and a foreign filesystem,
 * so it is rejected outright rather than "tried and diagnosed".
 */
export function validateBashPath(path: string): { ok: true; path: string } | { ok: false; reason: string } {
  const trimmed = path.trim()
  if (trimmed === '') return { ok: false, reason: 'empty path' }
  if (!isAbsolute(trimmed)) return { ok: false, reason: 'path is not absolute' }

  const normalized = resolve(trimmed)
  const leaf = normalized.substring(normalized.lastIndexOf(sep) + 1)
  const base = leaf.toLowerCase()
  if (base !== 'bash' && base !== 'bash.exe') {
    return { ok: false, reason: `executable name is "${leaf}", expected bash.exe` }
  }
  if (isWslBash(normalized)) {
    return { ok: false, reason: 'WSL launcher, not Git Bash' }
  }
  if (isDirectory(normalized)) return { ok: false, reason: 'path is a directory' }
  if (!isFile(normalized)) return { ok: false, reason: 'file does not exist' }
  return { ok: true, path: normalized }
}

/**
 * Whether a path is the Windows WSL launcher.
 *
 * `C:\Windows\System32\bash.exe` and its `WindowsApps` alias both start WSL, so
 * neither may ever be treated as an MSYS2 bash.
 */
export function isWslBash(path: string): boolean {
  const key = pathKey(resolve(path))
  const windowsRoot = pathKey(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows')
  if (key === `${windowsRoot}\\system32\\bash.exe`) return true
  if (key.startsWith(`${windowsRoot}\\system32\\`)) return true
  if (key.includes('\\windowsapps\\bash.exe')) return true
  // WSL's own installation root.
  if (key.startsWith('\\\\?\\') && key.includes('\\windowsapps\\')) return true
  return false
}

/** Expand `bashCandidates` entries: an executable, a `bin` directory, or an install root. */
export function candidateExecutables(candidate: string): string[] {
  const value = candidate.trim()
  if (value === '') return []
  const absolute = resolve(value)
  if (!isAbsolute(value)) return []

  // An explicit executable.
  const base = absolute.substring(absolute.lastIndexOf(sep) + 1).toLowerCase()
  if ((base === 'bash' || base === 'bash.exe') && existsSync(absolute)) return [absolute]

  // An install root or one of its bin directories.
  const results: string[] = []
  for (const suffix of [join('bin', 'bash.exe'), join('usr', 'bin', 'bash.exe'), 'bash.exe']) {
    const path = join(absolute, suffix)
    if (existsSync(path)) results.push(path)
  }
  return results
}
