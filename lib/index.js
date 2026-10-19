// src/config.ts
import z from "@deepseek-ai/schemastery";
import { LocalBashExecutor } from "@deepseek-ai/dsh-bash-local";
var Config = z.object({
  ...LocalBashExecutor.Config.dict,
  /**
   * Which terminal tool the session gets. `pwsh` is the default on purpose:
   * installing the plugin must not change behaviour until the user asks for
   * bash (F9).
   */
  dialect: z.union(["pwsh", "bash"]).default("pwsh").volatile(),
  /** Explicit bash executable. Empty means "discover". */
  bashPath: z.string().default("").volatile(),
  /**
   * Extra discovery roots or explicit executables, tried before the built-in
   * order. Accepts either a `bash.exe` or an installation root.
   */
  bashCandidates: z.array(z.string()).default([]).volatile(),
  /** Allow discovery when `bashPath` is empty. */
  autoDiscover: z.boolean().default(true).volatile(),
  /**
   * Upper bound for one discovery sweep. Discovery only stats the filesystem
   * (it never spawns a process), so this is a guard against pathological
   * candidate lists rather than a real timeout.
   */
  discoverTimeoutMs: z.number().default(1500).volatile(),
  /** Pass `-l` so the shell reads the login profile. */
  loginShell: z.boolean().default(false).volatile(),
  /** Directories prepended to the child PATH in addition to the install dirs. */
  extraPath: z.array(z.string()).default([]).volatile(),
  /** Export `PYTHONIOENCODING=utf-8` for the MSYS environment (F14). */
  pythonUtf8: z.boolean().default(true).volatile(),
  /**
   * What to do when a confined Windows sandbox cannot start Git Bash.
   *
   * - `unconfined` (default): launch bash directly, outside the sandbox. Nothing
   *   crashes, but the child is not file-sandboxed.
   * - `escalate`: keep the confined launch. The MSYS startup failure is then
   *   reported as a sandbox denial, which is what makes the first-party bash
   *   tool offer `sandbox_permissions` and lets the model retry with
   *   `danger-full-access` through the official approval flow. The approval
   *   itself belongs to that flow — the plugin never approves anything.
   * - `fail`: report a sandbox error instead of running anything.
   */
  confinedPolicy: z.union(["unconfined", "escalate", "fail"]).default("unconfined").volatile(),
  /**
   * How the official `minimal` preset is treated.
   *
   * `minimal` is the only shipped preset that runs a *persistent* shell, and on
   * Windows that shell is PowerShell (`dsh-tool-pwsh-persistent`). This plugin
   * only replaces the one-shot `bash` tool, so without this knob minimal
   * sessions silently fall back to a one-shot Git Bash.
   *
   * - `oneshot` (default): pre-0.5 behaviour — minimal gets the one-shot Git Bash.
   * - `leave`: minimal is untouched and keeps its persistent PowerShell.
   * - `variant`: minimal is untouched *and* a `minimal-gitbash` preset variant is
   *   registered so a new session can pick a persistent Git Bash.
   *
   * The default stays `oneshot` so upgrading does not change behaviour; the user
   * opts into the other two from the settings row.
   */
  minimalMode: z.union(["leave", "oneshot", "variant"]).default("oneshot").volatile()
});
function isVolatileLike(value) {
  return typeof value === "object" && value !== null && typeof value.get === "function";
}
function read(value, fallback) {
  const resolved = isVolatileLike(value) ? value.get() : value;
  if (resolved === void 0 || resolved === null) return fallback;
  return resolved;
}
function readArray(value) {
  const resolved = isVolatileLike(value) ? value.get() : value;
  if (!Array.isArray(resolved)) return [];
  return resolved.map((item) => String(item));
}
function readMinimalMode(value) {
  const resolved = read(value, "oneshot");
  if (resolved === "leave" || resolved === "variant") return resolved;
  return "oneshot";
}
function readConfinedPolicy(value) {
  const resolved = read(value, "unconfined");
  if (resolved === "escalate" || resolved === "fail") return resolved;
  return "unconfined";
}
var DEFAULTS = {
  timeoutMs: 12e4,
  maxTimeoutMs: 6e5,
  maxOutputBytes: 64e3,
  maxSpillBytes: 64 * 1024 * 1024,
  graceMs: 3e3
};
function snapshotConfig(config) {
  const source = config;
  const dialect = read(source.dialect, "pwsh");
  return Object.freeze({
    dialect: dialect === "bash" ? "bash" : "pwsh",
    bashPath: read(source.bashPath, "").trim(),
    bashCandidates: readArray(source.bashCandidates),
    autoDiscover: read(source.autoDiscover, true) !== false,
    discoverTimeoutMs: Math.max(0, Number(read(source.discoverTimeoutMs, 1500)) || 0),
    loginShell: read(source.loginShell, false) === true,
    extraPath: readArray(source.extraPath),
    pythonUtf8: read(source.pythonUtf8, true) !== false,
    confinedPolicy: readConfinedPolicy(source.confinedPolicy),
    minimalMode: readMinimalMode(source.minimalMode),
    cwd: read(source.cwd, "") || void 0,
    timeoutMs: read(source.timeoutMs, DEFAULTS.timeoutMs),
    maxTimeoutMs: read(source.maxTimeoutMs, DEFAULTS.maxTimeoutMs),
    maxOutputBytes: read(source.maxOutputBytes, DEFAULTS.maxOutputBytes),
    maxSpillBytes: read(source.maxSpillBytes, DEFAULTS.maxSpillBytes),
    graceMs: read(source.graceMs, DEFAULTS.graceMs)
  });
}
function executorConfig(snapshot) {
  return {
    confinedPolicy: snapshot.confinedPolicy,
    cwd: snapshot.cwd,
    timeoutMs: snapshot.timeoutMs,
    maxTimeoutMs: snapshot.maxTimeoutMs,
    maxOutputBytes: snapshot.maxOutputBytes,
    maxSpillBytes: snapshot.maxSpillBytes,
    graceMs: snapshot.graceMs
  };
}
function wantsBash(snapshot) {
  return snapshot.dialect === "bash";
}

// src/replace.ts
import * as ToolBash from "@deepseek-ai/dsh-tool-bash";

// src/diag.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
var LOG_NAME = "dsh-terminal-tool.log";
function diagnosticPath() {
  const configured = process.env.DSH_TERMINAL_TOOL_DIAG_FILE;
  if (configured !== void 0 && configured.trim() !== "") return configured;
  return join(tmpdir(), LOG_NAME);
}
function stamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function writeDiagnostic(message) {
  const line = `[${stamp()}] ${message}
`;
  try {
    const path = diagnosticPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line, "utf8");
  } catch {
  }
}
function skip(sessionId, reason, detail) {
  const suffix = detail === void 0 || detail === "" ? "" : `: ${detail}`;
  writeDiagnostic(`skip session=${sessionId} reason=${reason}${suffix}`);
  return reason;
}
function warn(sessionId, message) {
  writeDiagnostic(`warn session=${sessionId} ${message}`);
}
function note(sessionId, message) {
  writeDiagnostic(`ok session=${sessionId} ${message}`);
}

// src/executor.ts
import { LocalBashExecutor as LocalBashExecutor2 } from "@deepseek-ai/dsh-bash-local";
import {
  SandboxUnavailableError,
  classifyRunnerFailure as classifyRunnerFailureMatch,
  isRunnerSpawnFailure,
  matchesSignature
} from "@deepseek-ai/dsh-sandbox";

// src/paths.ts
import { existsSync, statSync } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join2, normalize, resolve, sep } from "node:path";
function pathKey(path) {
  let key = path.replace(/\//g, "\\").replace(/\\+$/, "");
  if (key === "") key = "\\";
  return key.toLowerCase();
}
function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function bashInstallRoot(bashPath) {
  const absolute = resolve(bashPath);
  const directory = dirname2(absolute);
  if (samePath(directory, join2(installRootGuess(directory), "bin"))) return installRootGuess(directory);
  if (samePath(directory, join2(installRootGuess(directory), "usr", "bin"))) return installRootGuess(directory);
  return directory;
}
function installRootGuess(directory) {
  const leaf = directory.substring(directory.lastIndexOf(sep) + 1).toLowerCase();
  if (leaf === "bin") {
    const parent = dirname2(directory);
    const parentLeaf = parent.substring(parent.lastIndexOf(sep) + 1).toLowerCase();
    if (parentLeaf === "usr") return dirname2(parent);
    return parent;
  }
  return directory;
}
function bashPathEntries(root, extra = []) {
  const entries = [];
  const push = (candidate) => {
    if (candidate !== "" && isDirectory(candidate)) entries.push(candidate);
  };
  for (const name2 of ["ucrt64", "mingw64", "clang64", "mingw32"]) {
    push(join2(root, name2, "bin"));
  }
  push(join2(root, "usr", "bin"));
  push(join2(root, "bin"));
  push(join2(root, "usr", "local", "bin"));
  for (const item of extra) push(item);
  return dedupe(entries);
}
function dedupe(entries) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const entry of entries) {
    const normalized = normalize(entry);
    const key = pathKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
function composePath(entries, hostPath) {
  const parts = [...entries];
  for (const part of (hostPath ?? "").split(";")) {
    if (part.trim() !== "") parts.push(part);
  }
  return dedupe(parts).join(";");
}
function validateBashPath(path) {
  const trimmed = path.trim();
  if (trimmed === "") return { ok: false, reason: "empty path" };
  if (!isAbsolute(trimmed)) return { ok: false, reason: "path is not absolute" };
  const normalized = resolve(trimmed);
  const leaf = normalized.substring(normalized.lastIndexOf(sep) + 1);
  const base = leaf.toLowerCase();
  if (base !== "bash" && base !== "bash.exe") {
    return { ok: false, reason: `executable name is "${leaf}", expected bash.exe` };
  }
  if (isWslBash(normalized)) {
    return { ok: false, reason: "WSL launcher, not Git Bash" };
  }
  if (isDirectory(normalized)) return { ok: false, reason: "path is a directory" };
  if (!isFile(normalized)) return { ok: false, reason: "file does not exist" };
  return { ok: true, path: normalized };
}
function isWslBash(path) {
  const key = pathKey(resolve(path));
  const windowsRoot = pathKey(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows");
  if (key === `${windowsRoot}\\system32\\bash.exe`) return true;
  if (key.startsWith(`${windowsRoot}\\system32\\`)) return true;
  if (key.includes("\\windowsapps\\bash.exe")) return true;
  if (key.startsWith("\\\\?\\") && key.includes("\\windowsapps\\")) return true;
  return false;
}
function candidateExecutables(candidate) {
  const value = candidate.trim();
  if (value === "") return [];
  const absolute = resolve(value);
  if (!isAbsolute(value)) return [];
  const base = absolute.substring(absolute.lastIndexOf(sep) + 1).toLowerCase();
  if ((base === "bash" || base === "bash.exe") && existsSync(absolute)) return [absolute];
  const results2 = [];
  for (const suffix of [join2("bin", "bash.exe"), join2("usr", "bin", "bash.exe"), "bash.exe"]) {
    const path = join2(absolute, suffix);
    if (existsSync(path)) results2.push(path);
  }
  return results2;
}

// src/confined.ts
var MSYS_DENIAL_SIGNATURES = [
  "ntcreatedirectoryobject(\\basenamedobjects\\msys-",
  "couldn't create signal pipe"
];
var MSYS_DENIAL_EXIT_CODES = [3221225794, 3221225506];
function isMsysStartupDenial(exitCode, stderr) {
  if (exitCode !== null && exitCode !== void 0 && MSYS_DENIAL_EXIT_CODES.includes(exitCode)) return true;
  const lowered = stderr.toLowerCase();
  return MSYS_DENIAL_SIGNATURES.some((signature) => lowered.includes(signature));
}
function planLaunch(input) {
  if (!input.hasSandbox || input.policyMode === void 0) return { kind: "direct" };
  if (input.policyMode === "danger-full-access") return { kind: "direct" };
  if (input.platform !== "win32") return { kind: "confine" };
  if (input.choice === "unconfined") return { kind: "direct" };
  if (input.choice === "escalate") return { kind: "confine" };
  return { kind: "fail", reason: unavailableReason(input.policyMode) };
}
function unavailableReason(mode) {
  return `Git Bash cannot start under the ${mode} sandbox on Windows; set confinedPolicy to "unconfined" or retry with sandbox_permissions: danger-full-access`;
}

// src/executor.ts
var GitBashExecutor = class extends LocalBashExecutor2 {
  /**
   * Only `subprocess` is injected. A composition without sandboxing must still
   * be able to mount this executor — the tool then simply has no escalation
   * parameter — so `sandbox` and `sandboxPolicy` are probed with `ctx.get()`,
   * matching how `tool-bash` treats them.
   */
  static inject = ["subprocess"];
  facts = /* @__PURE__ */ new Map();
  constructor(ctx, config) {
    super(ctx, config);
  }
  get extended() {
    return this.config;
  }
  get bashPath() {
    return this.extended.bashPath;
  }
  get pathEntries() {
    return this.extended.pathEntries;
  }
  get loginShell() {
    return this.extended.loginShell === true;
  }
  get pythonUtf8() {
    return this.extended.pythonUtf8 !== false;
  }
  get confinedPolicy() {
    return this.extended.confinedPolicy ?? "unconfined";
  }
  get sandbox() {
    return this.ctx.get("sandbox");
  }
  get sandboxPolicy() {
    return this.ctx.get("sandboxPolicy");
  }
  /**
   * The standing sandbox mode this executor can actually honour.
   *
   * `tool-bash` reads it to decide whether to expose `sandbox_permissions` and
   * whether the composition must provide a `sandboxPolicy` service, so it must
   * be `undefined` whenever the next launch would bypass the sandbox: under
   * `unconfined` on Windows every command runs outside it (see `planLaunch`),
   * and advertising the session's confined mode would describe commands as
   * sandboxed when they are not. `danger-full-access` stays visible, because
   * that mode really is unconfined.
   */
  get sandboxMode() {
    const mode = this.sandboxPolicy?.defaultMode;
    if (this.sandbox === void 0 || mode === void 0) return void 0;
    return this.bypassesSandbox(mode) ? void 0 : mode;
  }
  /** Whether `mode` would be launched outside the sandbox in this composition. */
  bypassesSandbox(mode) {
    if (mode === "danger-full-access") return false;
    return planLaunch({
      hasSandbox: true,
      policyMode: mode,
      choice: this.confinedPolicy,
      platform: process.platform
    }).kind === "direct";
  }
  /** The exact argv for one command. */
  argv(spec) {
    return [this.bashPath, ...this.loginShell ? ["-l"] : [], "-c", spec.command];
  }
  resolve(request) {
    const spec = super.resolve(request);
    const env = {
      ...spec.env,
      PATH: composePath(this.pathEntries, spec.env?.PATH ?? process.env.PATH ?? process.env.Path)
    };
    if (this.pythonUtf8 && env.PYTHONIOENCODING === void 0) env.PYTHONIOENCODING = "utf-8";
    return {
      ...spec,
      env,
      // `tool-bash` normally supplies the policy; this fallback keeps a direct
      // caller (tests, other tools) from reaching `confine()` with no policy.
      sandboxPolicy: spec.sandboxPolicy ?? this.sandboxPolicy?.resolve()
    };
  }
  async execute(spec) {
    const sandbox = this.sandbox;
    const policy = spec.sandboxPolicy;
    const argv = this.argv(spec);
    const plan = planLaunch({
      hasSandbox: sandbox !== void 0,
      policyMode: policy?.mode,
      choice: this.confinedPolicy,
      platform: process.platform
    });
    if (plan.kind === "direct") {
      const bypassed = policy !== void 0 && policy.mode !== "danger-full-access";
      const facts = { mode: bypassed ? "danger-full-access" : policy?.mode ?? "danger-full-access", denied: false };
      const execution2 = await this.executeArgv(spec, argv);
      return decorateResult(execution2, (result) => ({ ...result, sandbox: facts }));
    }
    if (plan.kind === "fail") {
      if (policy === void 0 || policy.mode === "danger-full-access") {
        throw new Error("confined launch plan without a confined sandbox policy");
      }
      throw new SandboxUnavailableError(policy.mode, plan.reason);
    }
    if (sandbox === void 0 || policy === void 0) {
      throw new Error("confined launch plan without a sandbox provider or policy");
    }
    const mode = policy.mode;
    if (mode === "danger-full-access") {
      throw new Error("confined launch plan with an unconfined sandbox policy");
    }
    const confinedPolicy = { ...policy, mode };
    let confined;
    const execution = await this.executeArgv(
      spec,
      async (signal) => {
        const prepared = await sandbox.confine(argv, confinedPolicy, signal);
        signal.throwIfAborted();
        confined = prepared;
        return prepared.argv;
      },
      (process2) => {
        const prepared = confined;
        if (prepared === void 0) return;
        this.facts.set(process2, {
          mode,
          enforcement: prepared.enforcement,
          denialSignatures: prepared.denialSignatures,
          runnerFailureRules: prepared.runnerFailureRules,
          runnerProgram: prepared.argv[0] ?? argv[0] ?? this.bashPath,
          workdir: spec.workdir
        });
      }
    );
    return decorateResult(
      execution,
      (result) => {
        if (confined === void 0) return { ...result, sandbox: { mode, denied: false } };
        const failure = classifyRunnerFailureMatch(result.exitCode, result.stderr.text, confined.runnerFailureRules);
        if (failure !== void 0) {
          throw new SandboxUnavailableError(mode, failure.detail);
        }
        return {
          ...result,
          sandbox: {
            mode,
            denied: matchesSignature(result.exitCode, result.stderr.text, confined.denialSignatures) || isMsysStartupDenial(result.exitCode, result.stderr.text),
            enforcement: confined.enforcement
          }
        };
      },
      (error) => {
        if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
        if (confined === void 0) throw error;
        if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
          throw new SandboxUnavailableError(mode, error instanceof Error ? error.message : String(error));
        }
        throw error;
      }
    );
  }
  onProcessDone(process2, stderr, providerRejected, providerError) {
    const facts = this.facts.get(process2);
    this.facts.delete(process2);
    if (facts !== void 0) {
      const runnerFailed = providerRejected ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir) : classifyRunnerFailureMatch(process2.exitCode, stderr, facts.runnerFailureRules) !== void 0;
      process2.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && (matchesSignature(process2.exitCode, stderr, facts.denialSignatures) || isMsysStartupDenial(process2.exitCode, stderr)),
        enforcement: facts.enforcement,
        ...runnerFailed ? { runnerFailed: true } : {}
      };
    }
    super.onProcessDone(process2, stderr, providerRejected, providerError);
  }
};
function decorateResult(execution, map, mapError) {
  const base = execution.result.bind(execution);
  let decorated;
  execution.result = () => {
    decorated ??= mapError === void 0 ? base().then(map) : base().then(map, mapError);
    return decorated;
  };
  return execution;
}

// src/discover.ts
import { execFile } from "node:child_process";
import { delimiter, dirname as dirname3, join as join3, resolve as resolve2 } from "node:path";
async function registryInstallPath(signal) {
  if (process.platform !== "win32") return void 0;
  const output = await new Promise((done) => {
    execFile(
      "reg.exe",
      ["query", "HKLM\\SOFTWARE\\GitForWindows", "/v", "InstallPath"],
      { encoding: "utf8", timeout: 1e3, windowsHide: true, signal },
      (error, stdout) => {
        if (error !== null) done(void 0);
        else done(stdout);
      }
    );
  });
  if (output === void 0) return void 0;
  const match = /InstallPath\s+REG_[A-Z_]+\s+(.+?)\s*$/im.exec(output);
  return match?.[1]?.trim();
}
function environmentRoots() {
  const roots = [];
  const push = (root, source) => {
    if (root === void 0 || root.trim() === "") return;
    roots.push({ path: resolve2(root), source });
  };
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  const systemDrive = process.env.SystemDrive ?? "C:";
  push(programFiles === void 0 ? void 0 : join3(programFiles, "Git"), "program-files");
  push(programFilesX86 === void 0 ? void 0 : join3(programFilesX86, "Git"), "program-files");
  push(localAppData === void 0 ? void 0 : join3(localAppData, "Programs", "Git"), "program-files");
  push(programFiles === void 0 ? void 0 : join3(programFiles, "MSYS2"), "msys2");
  push(join3(systemDrive, "msys64"), "msys2");
  push(localAppData === void 0 ? void 0 : join3(localAppData, "MSYS2"), "msys2");
  push(join3(systemDrive, "cygwin64"), "cygwin");
  push(join3(systemDrive, "cygwin"), "cygwin");
  return roots;
}
function bashFromGitOnPath() {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  for (const entry of pathValue.split(delimiter)) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    for (const name2 of ["git.exe", "git.cmd", "git.bat"]) {
      const git = join3(trimmed, name2);
      if (!isFile(git)) continue;
      const root = resolve2(dirname3(git), "..");
      for (const suffix of [join3("bin", "bash.exe"), join3("usr", "bin", "bash.exe")]) {
        const bash = join3(root, suffix);
        if (isFile(bash)) return { path: bash, source: "path" };
      }
    }
  }
  return void 0;
}
function expand(candidate) {
  return candidateExecutables(candidate.path).map((path) => ({ path, source: candidate.source }));
}
async function enumerateCandidates(options) {
  const rejected = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (candidate) => {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (isWslBash(candidate.path)) {
      rejected.push({ path: candidate.path, reason: "WSL launcher, not Git Bash" });
      return;
    }
    ordered.push(candidate);
  };
  const ordered = [];
  const explicit = options.bashPath.trim();
  if (explicit !== "") {
    push({ path: explicit, source: "configured" });
  }
  if (options.autoDiscover && !(options.explicitWins && explicit !== "")) {
    for (const item of options.bashCandidates) {
      if (item.trim() === "") continue;
      for (const candidate of expand({ path: item, source: "candidate" })) push(candidate);
    }
    const controller = new AbortController();
    const timer = options.timeoutMs > 0 ? setTimeout(() => {
      controller.abort(new Error("discovery timeout"));
    }, options.timeoutMs) : void 0;
    const signal = options.signal === void 0 ? controller.signal : AbortSignal.any([options.signal, controller.signal]);
    try {
      const registry = await registryInstallPath(signal);
      if (registry !== void 0 && !signal.aborted) {
        for (const candidate of expand({ path: registry, source: "registry" })) push(candidate);
      }
      for (const root of environmentRoots()) {
        for (const candidate of expand(root)) push(candidate);
      }
      const fromPath = bashFromGitOnPath();
      if (fromPath !== void 0) push(fromPath);
    } finally {
      if (timer !== void 0) clearTimeout(timer);
    }
  }
  const usable = [];
  for (const candidate of ordered) {
    const verdict = validateBashPath(candidate.path);
    if (verdict.ok) usable.push(candidate);
    else rejected.push({ path: candidate.path, reason: verdict.reason });
  }
  return { ordered: usable, rejected };
}
async function scanBashCandidates(options) {
  const { ordered } = await enumerateCandidates({ ...options, explicitWins: false });
  const rank = (candidate) => candidate.source === "configured" ? 0 : 1;
  const sorted = [...ordered].sort((left, right) => {
    const byRank = rank(left) - rank(right);
    if (byRank !== 0) return byRank;
    return left.path.localeCompare(right.path, "en");
  });
  return sorted.map((candidate) => ({ path: candidate.path, source: candidate.source, valid: true }));
}
async function discoverBash(options) {
  const { ordered, rejected } = await enumerateCandidates({ ...options, explicitWins: true });
  const considered = ordered.map((candidate) => candidate.path);
  const found = ordered[0];
  if (found === void 0) return { found: void 0, considered, rejected };
  return { found: { path: found.path, source: found.source }, considered, rejected };
}

// src/preset.ts
import { JSON_SCHEMA, Type, dump, load } from "js-yaml";
var VARIANT_ID = "minimal-gitbash";
var MINIMAL_ID = "minimal";
var SOURCE_ID = MINIMAL_ID;
var BACKEND_TYPE = "gitbash";
var PTY_ROW_ID = "gitbash-pty";
var PTY_ROW_NAME = "dsh-terminal-tool/pty";
var JsExpr = new Type("tag:yaml.org,2002:js", {
  kind: "scalar",
  resolve: (data) => typeof data === "string",
  construct: (data) => ({ __jsExpr: data }),
  predicate: (value) => value instanceof Object && "__jsExpr" in value,
  represent: (data) => String(data.__jsExpr)
});
var entryListSchema = JSON_SCHEMA.extend(JsExpr);
var VARIANT_NAME = "\u6781\u7B80\u6A21\u5F0F \xB7 Git Bash";
var VARIANT_DESCRIPTION = "minimal \u9884\u8BBE\u7684\u6301\u4E45 Git Bash \u7248\u672C\uFF1A\u4E00\u4E2A bash \u5DE5\u5177\uFF0C\u8DE8\u8C03\u7528\u4FDD\u6301\u72B6\u6001\u3002";
function cloneMinimalForGitBash(rows, spec) {
  const variant = structuredClone(rows);
  const shell = variant.find((row) => row["id"] === "persistent-shell");
  if (shell === void 0) throw new Error("minimal preset has no persistent-shell group");
  if (!Array.isArray(shell["config"])) throw new Error("persistent-shell has no row list");
  const inner = shell["config"];
  shell["config"] = inner.filter((row) => row["id"] !== "terminal-pwsh" && row["id"] !== "persistent-pwsh");
  const bash = shell["config"].find((row) => row["id"] === "persistent-bash");
  if (bash === void 0) throw new Error("minimal preset has no persistent-bash tool");
  delete bash["disabled"];
  bash["config"] = { ...bash["config"], backendType: BACKEND_TYPE };
  const anchor = shell["config"].findIndex((row) => row["id"] === "pty");
  if (anchor < 0) throw new Error("minimal preset has no pty row");
  shell["config"].splice(anchor + 1, 0, {
    id: PTY_ROW_ID,
    name: PTY_ROW_NAME,
    config: {
      backendType: BACKEND_TYPE,
      bashPath: spec.bashPath,
      confinedPolicy: spec.confinedPolicy,
      loginShell: spec.loginShell,
      pythonUtf8: spec.pythonUtf8
    }
  });
  return variant;
}
function parsePresetRows(yamlText) {
  const parsed = load(yamlText, { schema: entryListSchema });
  if (!Array.isArray(parsed)) throw new Error("preset document is not a row list");
  return parsed;
}
function service(ctx, name2) {
  try {
    return ctx.get(name2);
  } catch {
    return void 0;
  }
}
function countReferences(ctx) {
  let live = 0;
  const sessions = service(ctx, "sessions");
  if (sessions !== void 0) {
    const projections = service(ctx, "sessionProjections");
    for (const session of sessions.list()) {
      const projected = projections?.stateOf(session, "agentPreset");
      const preset = typeof projected === "string" ? projected : session.header?.agentPreset;
      if (preset === VARIANT_ID) live += 1;
    }
  }
  return live;
}
async function countPersistedReferences(ctx) {
  const query = service(
    ctx,
    "sessionQuery"
  );
  if (query === void 0) return 0;
  try {
    const records = await query.listSessions();
    return records.filter((record) => record.header?.agentPreset === VARIANT_ID).length;
  } catch (error) {
    writeDiagnostic(`variant: sessionQuery scan failed: ${messageOf(error)}`);
    return 0;
  }
}
function specSignature(spec) {
  return [spec.bashPath, spec.confinedPolicy, spec.loginShell ? "login" : "plain", spec.pythonUtf8 ? "utf8" : "raw"].join("|");
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function createVariantManager(ctx) {
  let current = { status: "absent", refs: 0 };
  let definition;
  let unregister;
  let signature;
  let inflight;
  let disposed = false;
  const view = () => ({
    status: current.status,
    id: VARIANT_ID,
    refs: current.refs,
    ...current.reason === void 0 ? {} : { reason: current.reason }
  });
  const set = (next) => {
    current = next;
    return view();
  };
  function presets() {
    return service(ctx, "agentPresets");
  }
  async function references() {
    return countReferences(ctx) + await countPersistedReferences(ctx);
  }
  async function register(spec) {
    const presetsService = presets();
    if (presetsService === void 0) {
      return set({ status: "failed", refs: 0, reason: "agentPresets service is not available" });
    }
    try {
      const document = await presetsService.readDocument(SOURCE_ID);
      const rows = cloneMinimalForGitBash(parsePresetRows(document.content), spec);
      definition = { id: VARIANT_ID, plugins: rows };
      unregister = await presetsService.register({
        id: VARIANT_ID,
        name: VARIANT_NAME,
        description: VARIANT_DESCRIPTION,
        order: 3.1,
        plugins: rows
      });
      writeDiagnostic(`variant: registered ${VARIANT_ID} bash=${spec.bashPath}`);
      return set({ status: "registered", refs: 0 });
    } catch (error) {
      const reason = messageOf(error);
      writeDiagnostic(`variant: registration failed: ${reason}`);
      unregister = void 0;
      definition = void 0;
      return set({ status: "failed", refs: 0, reason });
    }
  }
  async function unregisterVariant() {
    const drop = unregister;
    unregister = void 0;
    definition = void 0;
    signature = void 0;
    if (drop === void 0) return;
    try {
      await drop();
      writeDiagnostic(`variant: unregistered ${VARIANT_ID}`);
    } catch (error) {
      writeDiagnostic(`variant: unregister failed: ${messageOf(error)}`);
    }
  }
  async function converge(mode, spec) {
    const wanted = mode === "variant";
    const refs = await references();
    if (!wanted) {
      if (definition === void 0) return set({ status: "absent", refs });
      if (refs > 0) {
        return set({ status: "retained", refs });
      }
      await unregisterVariant();
      return set({ status: "absent", refs: 0 });
    }
    const resolved = await spec();
    if (resolved === void 0) {
      if (definition !== void 0) return set({ status: "registered", refs });
      return set({ status: "failed", refs: 0, reason: "Git Bash was not found" });
    }
    if (definition !== void 0) {
      if (signature === specSignature(resolved)) {
        const registered = unregister !== void 0;
        return set({ status: registered ? "registered" : "failed", refs });
      }
      writeDiagnostic("variant: inputs changed; rebuilding the definition");
      await unregisterVariant();
    }
    signature = specSignature(resolved);
    return register(resolved);
  }
  return {
    state: view,
    async verify() {
      if (definition === void 0) return view();
      const presetsService = presets();
      if (presetsService === void 0) return view();
      try {
        const roster = await presetsService.list();
        const entry = roster.find((row) => row.id === VARIANT_ID);
        if (entry?.broken !== void 0) {
          writeDiagnostic(`variant: mount failed: ${entry.broken}`);
          return set({ status: "failed", refs: current.refs, reason: entry.broken });
        }
      } catch (error) {
        writeDiagnostic(`variant: roster check failed: ${messageOf(error)}`);
      }
      return view();
    },
    async sync(mode, spec) {
      if (disposed) return view();
      if (inflight !== void 0) {
        await inflight.catch(() => void 0);
        if (disposed) return view();
      }
      const pass = converge(mode, spec).catch((error) => {
        writeDiagnostic(`variant: sync failed: ${messageOf(error)}`);
        return set({ status: "failed", refs: current.refs, reason: messageOf(error) });
      });
      inflight = pass;
      try {
        return await pass;
      } finally {
        if (inflight === pass) inflight = void 0;
      }
    },
    async release() {
      disposed = true;
      if (inflight !== void 0) await inflight.catch(() => void 0);
      await unregisterVariant();
      signature = void 0;
      current = { status: "absent", refs: 0 };
    }
  };
}
async function resolveVariantSpec(options) {
  if (options.bashPath.trim() !== "") {
    return {
      bashPath: options.bashPath.trim(),
      confinedPolicy: options.confinedPolicy,
      loginShell: options.loginShell,
      pythonUtf8: options.pythonUtf8
    };
  }
  const report = await discoverBash({
    bashPath: options.bashPath,
    bashCandidates: options.bashCandidates,
    autoDiscover: options.autoDiscover,
    timeoutMs: options.timeoutMs
  });
  if (report.found === void 0) return void 0;
  return {
    bashPath: report.found.path,
    confinedPolicy: options.confinedPolicy,
    loginShell: options.loginShell,
    pythonUtf8: options.pythonUtf8
  };
}

// src/replace.ts
var TOOL_PWSH_ORDER = 1010;
function optional(ctx, name2) {
  return ctx.get(name2);
}
function presetOf(agentCtx, agent) {
  const projections = optional(agentCtx, "sessionProjections");
  const projected = projections?.stateOf(agent.session, "agentPreset");
  if (typeof projected === "string") return projected;
  const header = agent.session.header;
  return header?.agentPreset;
}
async function installSession(ctx, agent, snapshot) {
  const id = String(agent.id);
  if (process.platform !== "win32") return { status: "skipped", reason: skip(id, "not-win32") };
  if (snapshot.dialect !== "bash") return { status: "skipped", reason: skip(id, "dialect-pwsh") };
  const agentCtx = agent.ctx;
  if (agentCtx === void 0) return { status: "skipped", reason: skip(id, "no-agent-context") };
  const preset = presetOf(agentCtx, agent);
  if (preset === VARIANT_ID) return { status: "skipped", reason: skip(id, "already-replaced") };
  if (preset === MINIMAL_ID && snapshot.minimalMode !== "oneshot") {
    return { status: "skipped", reason: skip(id, "minimal-left", snapshot.minimalMode) };
  }
  const tools = optional(agentCtx, "tools");
  const systemPrompt = optional(agentCtx, "systemPrompt");
  if (tools === void 0) return { status: "skipped", reason: skip(id, "missing-service", "tools") };
  if (systemPrompt === void 0) {
    return { status: "skipped", reason: skip(id, "missing-service", "systemPrompt") };
  }
  if (tools.get("bash", agent) !== void 0) {
    return { status: "skipped", reason: skip(id, "already-replaced") };
  }
  const discovery = await discoverBash({
    bashPath: snapshot.bashPath,
    bashCandidates: snapshot.bashCandidates,
    autoDiscover: snapshot.autoDiscover,
    timeoutMs: snapshot.discoverTimeoutMs
  });
  const found = discovery.found;
  if (found === void 0) {
    const detail = discovery.rejected.length === 0 ? `no candidate found (${discovery.considered.length} considered)` : discovery.rejected.map((item) => `${item.path}: ${item.reason}`).join("; ");
    return { status: "skipped", reason: skip(id, "bash-not-found", detail) };
  }
  const installRoot = bashInstallRoot(found.path);
  const pathEntries = bashPathEntries(installRoot, snapshot.extraPath);
  const undo = [];
  const fibers = [];
  try {
    const shellCtx = agentCtx.isolate("shell");
    const executorHost = await shellCtx.plugin(GitBashExecutor, {
      ...executorConfig(snapshot),
      bashPath: found.path,
      pathEntries,
      loginShell: snapshot.loginShell,
      pythonUtf8: snapshot.pythonUtf8
    });
    fibers.push(executorHost);
    const toolHost = await shellCtx.plugin(ToolBash, {
      enableRunInBackground: true,
      promoteOnTimeout: true
    });
    fibers.push(toolHost);
    if (tools.get("bash", agent) === void 0) {
      throw new Error("tool-bash mounted but did not register a bash tool");
    }
    if (tools.get("pwsh", agent) !== void 0) {
      undo.push(tools.restrict({ deny: ["pwsh"] }));
      try {
        undo.push(
          systemPrompt.section({
            name: "tool:pwsh",
            order: systemPrompt.getSectionOrder("TOOL_PWSH") ?? TOOL_PWSH_ORDER,
            text: ""
          })
        );
      } catch (error) {
        warn(id, `cannot shadow the tool:pwsh prompt section: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      warn(id, "no inherited pwsh tool to hide; leaving the inherited tool list alone");
    }
    agentCtx.effect(() => () => {
      for (const disposer of undo.reverse()) {
        try {
          disposer();
        } catch {
        }
      }
    });
    note(id, `bash=${found.path} source=${found.source} path=${pathEntries.length} entries`);
    return { status: "installed", bashPath: found.path };
  } catch (error) {
    for (const disposer of undo.reverse()) {
      try {
        disposer();
      } catch {
      }
    }
    for (const fiber of fibers.reverse()) {
      try {
        await fiber.dispose();
      } catch {
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "skipped", reason: skip(id, "mount-failed", detail) };
  }
}

// src/shared/protocol.ts
var ROUTE_STATE = "/api/dsh-terminal-tool/state";
var ROUTE_DISCOVER = "/api/dsh-terminal-tool/discover";

// src/routes.ts
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
async function readBody(request) {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function messageOf2(error) {
  return error instanceof Error ? error.message : String(error);
}
function toView(candidate) {
  return { path: candidate.path, source: candidate.source, valid: true };
}
function createHandlers(deps) {
  const state = () => {
    const snapshot = deps.readSnapshot();
    const lastReplace2 = deps.lastReplace();
    return {
      platform: process.platform,
      settingsAvailable: deps.settingsAvailable(),
      dialect: snapshot.dialect,
      bashPath: snapshot.bashPath,
      bashCandidates: snapshot.bashCandidates,
      capability: deps.capability(),
      minimalMode: snapshot.minimalMode,
      variant: deps.variant(),
      ...lastReplace2 === void 0 ? {} : { lastReplace: lastReplace2 }
    };
  };
  const discover = async (body) => {
    const snapshot = deps.readSnapshot();
    const inFlight = typeof body.bashPath === "string" ? body.bashPath : "";
    const saved = inFlight.length > 0 ? inFlight : snapshot.bashPath;
    const candidates = await scanBashCandidates({
      bashPath: saved,
      bashCandidates: snapshot.bashCandidates,
      autoDiscover: true,
      timeoutMs: snapshot.discoverTimeoutMs
    });
    return { candidates: candidates.map(toView) };
  };
  return { state, discover };
}
function registerRoutes(ctx, deps) {
  const handlers = createHandlers(deps);
  const attach = (scoped) => {
    const resolved = scoped.get("connection");
    const connection = resolved ?? scoped.connection;
    if (connection === void 0 || connection === null || typeof connection.fetch?.register !== "function") {
      writeDiagnostic("routes: ctx.connection.fetch is not visible; settings row will report no state");
      return;
    }
    const route = (path, handler) => ({
      path,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        try {
          const body = await readBody(request);
          return jsonResponse(await handler(body), 200);
        } catch (error) {
          writeDiagnostic(`route ${path} failed: ${messageOf2(error)}`);
          return jsonResponse({ ok: false, error: messageOf2(error) }, 200);
        }
      }
    });
    for (const path of [ROUTE_STATE, ROUTE_DISCOVER]) {
      const spec = path === ROUTE_STATE ? route(path, () => handlers.state()) : route(path, (body) => handlers.discover(body));
      const dispose = connection.fetch.register(spec);
      scoped.effect(() => dispose, `terminal-tool: fetch route ${path}`);
    }
    writeDiagnostic("routes: registered /state and /discover");
  };
  try {
    ctx.inject(["connection"], (scoped) => {
      attach(scoped);
    });
  } catch (error) {
    writeDiagnostic(`routes: cannot inject connection: ${messageOf2(error)}`);
  }
}

// src/index.ts
var name = "terminal-tool";
var inject = [];
var results = /* @__PURE__ */ new Map();
function installResultFor(agentId) {
  return results.get(agentId);
}
var lastReplace;
function visible(ctx, name2) {
  try {
    return ctx.get(name2) !== void 0;
  } catch {
    return false;
  }
}
function probeCapability(ctx) {
  if (process.platform !== "win32") return { supported: false, reason: "\u4EC5 Windows \u652F\u6301\u5207\u6362\u7EC8\u7AEF\u5DE5\u5177" };
  if (!visible(ctx, "tools")) return { supported: false, reason: "\u5F53\u524D DSH \u7248\u672C\u4E0D\u63D0\u4F9B ctx.tools\uFF08\u65E0\u6CD5\u9690\u85CF pwsh\uFF09" };
  if (!visible(ctx, "systemPrompt")) {
    return { supported: false, reason: "\u5F53\u524D DSH \u7248\u672C\u4E0D\u63D0\u4F9B ctx.systemPrompt\uFF08\u65E0\u6CD5\u538B\u6389 pwsh \u63D0\u793A\u8BCD\uFF09" };
  }
  return { supported: true };
}
function apply(ctx, config) {
  const initial = snapshotConfig(config);
  if (!wantsBash(initial)) {
    writeDiagnostic("loaded with dialect=pwsh; sessions keep the platform terminal tool");
  }
  const variant = createVariantManager(ctx);
  const syncVariant = (snapshot) => {
    void variant.sync(
      snapshot.minimalMode,
      () => resolveVariantSpec({
        bashPath: snapshot.bashPath,
        bashCandidates: snapshot.bashCandidates,
        autoDiscover: snapshot.autoDiscover,
        timeoutMs: snapshot.discoverTimeoutMs,
        confinedPolicy: snapshot.confinedPolicy,
        loginShell: snapshot.loginShell,
        pythonUtf8: snapshot.pythonUtf8
      })
    ).catch((error) => {
      writeDiagnostic(`variant: sync failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  ctx.inject(["agentPresets"], () => {
    syncVariant(snapshotConfig(config));
  });
  ctx.effect(() => () => variant.release(), "terminal-tool: variant");
  ctx.on("loader/volatile-update", () => {
    syncVariant(snapshotConfig(config));
  });
  registerRoutes(ctx, {
    readSnapshot: () => snapshotConfig(config),
    capability: () => probeCapability(ctx),
    settingsAvailable: () => visible(ctx, "settings"),
    lastReplace: () => lastReplace,
    // `list()` re-audits the preset tree and waits for the Host Loader to
    // settle, so it can only run once this row's activation is over. The
    // handler is therefore a read plus a fire-and-forget refresh: the next
    // `/state` (or the next session) reports the truth.
    variant: () => {
      void variant.verify();
      return variant.state();
    }
  });
  ctx.on("agent/created", async (payload) => {
    const agent = payload.agent;
    const id = String(agent.id);
    try {
      const result = await installSession(ctx, agent, snapshotConfig(config));
      results.set(id, result);
      lastReplace = result.status === "installed" ? { at: Date.now(), applied: true } : { at: Date.now(), applied: false, reason: result.reason };
      if (result.status === "installed") {
        writeDiagnostic(`installed session=${id} bash=${result.bashPath}`);
      }
    } catch (error) {
      results.set(id, { status: "skipped", reason: "mount-failed" });
      lastReplace = { at: Date.now(), applied: false, reason: "mount-failed" };
      writeDiagnostic(
        `error session=${id} unexpected ${error instanceof Error ? error.stack ?? error.message : String(error)}`
      );
    }
    return void 0;
  });
  ctx.on("agent/disposed", (payload) => {
    results.delete(String(payload.agent.id));
  });
}
function dialectOf(config) {
  return snapshotConfig(config).dialect;
}
export {
  Config,
  apply,
  dialectOf,
  inject,
  installResultFor,
  name,
  probeCapability
};
//# sourceMappingURL=index.js.map
