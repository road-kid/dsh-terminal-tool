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
  pythonUtf8: z.boolean().default(true).volatile()
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
    cwd: snapshot.cwd,
    timeoutMs: snapshot.timeoutMs,
    maxTimeoutMs: snapshot.maxTimeoutMs,
    maxOutputBytes: snapshot.maxOutputBytes,
    maxSpillBytes: snapshot.maxSpillBytes,
    graceMs: snapshot.graceMs
  };
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
  for (const name of ["ucrt64", "mingw64", "clang64", "mingw32"]) {
    push(join2(root, name, "bin"));
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
  const results = [];
  for (const suffix of [join2("bin", "bash.exe"), join2("usr", "bin", "bash.exe"), "bash.exe"]) {
    const path = join2(absolute, suffix);
    if (existsSync(path)) results.push(path);
  }
  return results;
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
  get sandbox() {
    return this.ctx.get("sandbox");
  }
  get sandboxPolicy() {
    return this.ctx.get("sandboxPolicy");
  }
  /**
   * The standing sandbox mode, or `undefined` when this composition has no
   * sandbox provider. `tool-bash` reads this to decide whether to expose
   * `sandbox_permissions`; reporting a mode we cannot confine would advertise
   * an escalation that must fail.
   */
  get sandboxMode() {
    return this.sandbox === void 0 ? void 0 : this.sandboxPolicy?.defaultMode;
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
    if (sandbox === void 0 || policy === void 0 || policy.mode === "danger-full-access") {
      const mode2 = policy?.mode ?? "danger-full-access";
      const execution2 = await this.executeArgv(spec, argv);
      return decorateResult(execution2, (result) => ({ ...result, sandbox: { mode: mode2, denied: false } }));
    }
    const mode = policy.mode;
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
            denied: matchesSignature(result.exitCode, result.stderr.text, confined.denialSignatures),
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
        denied: !runnerFailed && matchesSignature(process2.exitCode, stderr, facts.denialSignatures),
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
import { existsSync as existsSync2 } from "node:fs";
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
    for (const name of ["git.exe", "git.cmd", "git.bat"]) {
      const git = join3(trimmed, name);
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
async function discoverBash(options) {
  const considered = [];
  const rejected = [];
  const accept = (path) => {
    const verdict = validateBashPath(path);
    if (verdict.ok) return true;
    if (!considered.includes(path) && verdict.reason !== "file does not exist") {
      rejected.push({ path, reason: verdict.reason });
    }
    return false;
  };
  const explicit = options.bashPath.trim();
  if (explicit !== "") {
    considered.push(explicit);
    if (accept(explicit)) return { found: { path: explicit, source: "configured" }, considered, rejected };
  }
  if (!options.autoDiscover) {
    if (explicit !== "") rejected.push({ path: explicit, reason: "configured path is not a usable bash" });
    return { found: void 0, considered, rejected };
  }
  const controller = new AbortController();
  const timer = options.timeoutMs > 0 ? setTimeout(() => {
    controller.abort(new Error("discovery timeout"));
  }, options.timeoutMs) : void 0;
  const signal = options.signal === void 0 ? controller.signal : AbortSignal.any([options.signal, controller.signal]);
  try {
    const ordered = [];
    for (const item of options.bashCandidates) {
      if (item.trim() === "") continue;
      ordered.push(...expand({ path: item, source: "candidate" }));
    }
    const registry = await registryInstallPath(signal);
    if (registry !== void 0 && !signal.aborted) {
      ordered.push(...expand({ path: registry, source: "registry" }));
    }
    for (const root of environmentRoots()) ordered.push(...expand(root));
    const fromPath = bashFromGitOnPath();
    if (fromPath !== void 0) ordered.push(fromPath);
    for (const candidate of ordered) {
      if (signal.aborted) break;
      if (considered.includes(candidate.path)) continue;
      considered.push(candidate.path);
      if (isWslBash(candidate.path)) {
        rejected.push({ path: candidate.path, reason: "WSL launcher, not Git Bash" });
        continue;
      }
      if (!existsSync2(candidate.path)) continue;
      if (accept(candidate.path)) return { found: { path: candidate.path, source: candidate.source }, considered, rejected };
    }
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
  return { found: void 0, considered, rejected };
}

// src/replace.ts
var TOOL_PWSH_ORDER = 1010;
function optional(ctx, name) {
  return ctx.get(name);
}
async function installSession(ctx, agent, snapshot) {
  const id = String(agent.id);
  if (process.platform !== "win32") return { status: "skipped", reason: skip(id, "not-win32") };
  if (snapshot.dialect !== "bash") return { status: "skipped", reason: skip(id, "dialect-pwsh") };
  const agentCtx = agent.ctx;
  if (agentCtx === void 0) return { status: "skipped", reason: skip(id, "no-agent-context") };
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
      undo.push(
        systemPrompt.section({
          name: "tool:pwsh",
          order: systemPrompt.getSectionOrder("TOOL_PWSH") ?? TOOL_PWSH_ORDER,
          text: ""
        })
      );
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
export {
  GitBashExecutor,
  diagnosticPath,
  discoverBash,
  installSession,
  snapshotConfig,
  writeDiagnostic
};
//# sourceMappingURL=testing.js.map
