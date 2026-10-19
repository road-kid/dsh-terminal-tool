// src/pty.ts
import z from "@deepseek-ai/schemastery";
import { SandboxUnavailableError } from "@deepseek-ai/dsh-sandbox";
import { BashTerminalBackend } from "@deepseek-ai/dsh-terminal-bash";

// src/confined.ts
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

// src/pty.ts
var DEFAULT_BACKEND_TYPE = "gitbash";
var name = "terminal-tool-pty";
var inject = ["terminals", "subprocess", "sandboxPolicy"];
var Config = z.object({
  /** Type this backend registers under; preset rows must use the same value. */
  backendType: z.string().default(DEFAULT_BACKEND_TYPE),
  /** Absolute path of the Git Bash executable. Required at runtime. */
  bashPath: z.string().default(""),
  /** Arguments passed to bash; mirrors the official one-shot defaults. */
  shellArgs: z.array(z.string()).default(["--noprofile", "--norc", "-i"]),
  /** Export `PYTHONIOENCODING=utf-8` for the MSYS environment. */
  pythonUtf8: z.boolean().default(true),
  /** Read the login profile (`-l`), matching the one-shot executor's flag. */
  loginShell: z.boolean().default(false),
  /** Same three-value policy the one-shot executor uses. */
  confinedPolicy: z.union(["unconfined", "escalate", "fail"]).default("unconfined")
});
var TERMINAL_DEFAULTS = {
  rows: 40,
  cols: 160,
  scrollbackLines: 1e4,
  scrollbackMaxBytes: 4 * 1024 * 1024,
  maxReadBytes: 256 * 1024,
  pollIntervalMs: 50,
  exactProbeAfterMs: 150,
  idleSilenceMs: 3e3,
  handoffGraceMs: 500,
  promptTailGraceMs: 0,
  timeoutMs: 3e4,
  disposeGraceMs: 3e3
};
function resolveBackendConfig(config) {
  const shellPath = config.bashPath.trim();
  if (shellPath === "") throw new Error("terminal-tool/pty: bashPath must be non-empty");
  const backendType = config.backendType.trim();
  if (backendType === "") throw new Error("terminal-tool/pty: backendType must be non-empty");
  return {
    ...TERMINAL_DEFAULTS,
    backendType,
    shellDialect: "bash",
    shellPath,
    // A login shell is the one argument this backend adds on top of the official
    // defaults: `--noprofile --norc` would otherwise defeat `-l`.
    shellArgs: config.loginShell ? ["-l", ...config.shellArgs ?? []] : [...config.shellArgs ?? []]
  };
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
async function apply(ctx, config) {
  const resolved = resolveBackendConfig(config);
  const policy = ctx.get("sandboxPolicy");
  const choice = config.confinedPolicy;
  try {
    const backend = new BashTerminalBackend(ctx, resolved, async (spec) => {
      const plan = planLaunch({
        hasSandbox: policy !== void 0,
        policyMode: policy?.defaultMode,
        choice,
        platform: process.platform
      });
      if (plan.kind === "fail") {
        const mode = policy?.defaultMode;
        throw new SandboxUnavailableError(mode === "read-only" ? "read-only" : "workspace-write", plan.reason);
      }
      if (plan.kind === "confine") return ctx.subprocess.spawnTerminal(spec);
      const env = config.pythonUtf8 ? { ...spec.env, PYTHONIOENCODING: "utf-8" } : spec.env;
      return ctx.subprocess.spawnTerminal({
        ...spec,
        argv: [resolved.shellPath, ...resolved.shellArgs],
        env
      });
    });
    ctx.terminals.registerBackend(backend);
    writeDiagnostic(`pty: registered backend=${resolved.backendType} bash=${resolved.shellPath} policy=${choice}`);
  } catch (error) {
    writeDiagnostic(`pty: backend registration failed: ${messageOf(error)}`);
  }
}
export {
  Config,
  DEFAULT_BACKEND_TYPE,
  apply,
  inject,
  name
};
//# sourceMappingURL=pty.js.map
