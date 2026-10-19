window.__ModuleLoader__.load({ id: "dsh-terminal-tool", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  GENERAL_ITEM_ID: () => GENERAL_ITEM_ID,
  GENERAL_ITEM_ORDER: () => GENERAL_ITEM_ORDER,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/styles.ts
var PLUGIN_ID = "dsh-terminal-tool";
var STYLE_TAG_ID = "dsh-terminal-tool/row.css";
var CSS = `
.tterm-group{display:flex;flex-direction:column;gap:12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.tterm-row{display:flex;align-items:center;justify-content:space-between;gap:24px}
.tterm-text{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.tterm-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.tterm-description{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.tterm-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.tterm-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.tterm-field-label{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.tterm-dialect{display:inline-flex;flex:none}
.tterm-selector{box-sizing:border-box;display:inline-flex;align-items:center;gap:12px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.tterm-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.tterm-selector:disabled{cursor:not-allowed;opacity:.4}
.tterm-selector-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.tterm-chevron{flex:none}
.tterm-path-control{display:flex;align-items:center;gap:8px;flex:none;width:min(440px,100%)}
.tterm-path-input{flex:1;min-width:0}
.tterm-path-selector{display:flex;flex:1;min-width:0}
.tterm-path-selector .tterm-selector{width:100%}
`.trim();
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`) !== null) return;
  const style = document.createElement("style");
  style.setAttribute("data-plugin", PLUGIN_ID);
  style.setAttribute("data-plugin-css", STYLE_TAG_ID);
  style.textContent = CSS;
  document.head.append(style);
}
injectStyles();

// src/client/locales.ts
var LOCALE_NAMESPACE = "terminal-tool";
var zh = {
  "row.title": "\u7EC8\u7AEF\u5DE5\u5177",
  "row.description": "\u6A21\u578B\u6267\u884C\u547D\u4EE4\u65F6\u4F7F\u7528\u7684\u7EC8\u7AEF\uFF1B\u6539\u52A8\u53EA\u5F71\u54CD\u65B0\u4F1A\u8BDD\u3002",
  "row.dialect.label": "\u7EC8\u7AEF\u7C7B\u578B",
  "row.dialect.pwsh": "PowerShell\uFF08pwsh\uFF09",
  "row.dialect.bash": "Git Bash\uFF08bash\uFF09",
  "row.path.label": "Git Bash \u8DEF\u5F84",
  "row.path.placeholder": "\u4F8B\u5982 C:/Program Files/Git/bin/bash.exe",
  "row.path.none": "\u5C1A\u672A\u9009\u62E9",
  "row.path.missing": "\u70B9\u300C\u81EA\u52A8\u53D1\u73B0\u300D\u626B\u63CF\u672C\u673A\uFF0C\u6216\u76F4\u63A5\u586B\u5165 bash.exe \u7684\u5B8C\u6574\u8DEF\u5F84\u3002",
  "row.confined.label": "\u53D7\u9650\u6C99\u7BB1\u65F6",
  "row.confined.description": "Windows \u6C99\u7BB1\u4F1A\u628A\u547D\u4EE4\u964D\u5230\u4F4E\u5B8C\u6574\u6027\uFF0CGit Bash \u65E0\u6CD5\u5728\u5176\u4E2D\u542F\u52A8\uFF1B\u8FD9\u91CC\u51B3\u5B9A\u6B64\u65F6\u600E\u4E48\u529E\u3002",
  "row.confined.unconfined": "\u76F4\u63A5\u542F\u52A8\uFF08\u4E0D\u7ECF\u6C99\u7BB1\uFF09",
  "row.confined.escalate": "\u53D7\u9650\u6267\u884C\uFF0C\u5931\u8D25\u540E\u5347\u7EA7",
  "row.confined.fail": "\u62A5\u544A\u9519\u8BEF",
  "row.confined.unconfinedNotice": "\u6CE8\u610F\uFF1A\u9009\u5B83\u4E4B\u540E\uFF0C\u6A21\u578B\u6267\u884C\u7684\u547D\u4EE4\u4E0D\u53D7\u6587\u4EF6\u6C99\u7BB1\u9650\u5236\u3002",
  "row.minimal.label": "\u6781\u7B80\u6A21\u5F0F",
  "row.minimal.description": "\u53EA\u5F71\u54CD\u4F7F\u7528\u5B98\u65B9\u300C\u6781\u7B80\u6A21\u5F0F\u300D\u9884\u8BBE\u7684\u4F1A\u8BDD\uFF1A\u4FDD\u6301\u5B98\u65B9\u7684\u6301\u4E45\u7EC8\u7AEF\uFF0C\u6216\u8BA9\u672C\u63D2\u4EF6\u7684 bash \u63A5\u624B\u3002",
  "row.minimal.leave": "\u4FDD\u6301\u5B98\u65B9\u6301\u4E45\u7EC8\u7AEF",
  "row.minimal.oneshot": "\u6362\u6210\u4E00\u6B21\u6027 bash",
  "row.minimal.variant": "\u6DFB\u52A0 Git Bash \u53D8\u4F53",
  "row.minimal.variantReady": "\u5DF2\u5728\u9884\u8BBE\u5217\u8868\u4E2D\u6DFB\u52A0\u300C{id}\u300D\uFF0C\u65B0\u5EFA\u4F1A\u8BDD\u65F6\u53EF\u9009\u3002",
  "row.minimal.variantRetained": "\u4ECD\u6709 {count} \u4E2A\u4F1A\u8BDD\u5728\u4F7F\u7528\u300C{id}\u300D\uFF0C\u56E0\u6B64\u6CA1\u6709\u79FB\u9664\u5B83\uFF1B\u8FD9\u4E9B\u4F1A\u8BDD\u4ECD\u7136\u53EF\u4EE5\u6253\u5F00\u3002",
  "row.minimal.variantFailed": "\u53D8\u4F53\u6CE8\u518C\u5931\u8D25\uFF1A{reason}",
  "row.discover": "\u81EA\u52A8\u53D1\u73B0",
  "row.discovering": "\u6B63\u5728\u626B\u63CF\u2026",
  "row.foundNone": "\u6CA1\u6709\u627E\u5230 Git Bash\uFF0C\u8BF7\u76F4\u63A5\u586B\u5165 bash.exe \u7684\u5B8C\u6574\u8DEF\u5F84\u3002",
  "row.notSupported": "\u5F53\u524D DSH \u7248\u672C\u4E0D\u652F\u6301\u81EA\u52A8\u5207\u6362\uFF1A{reason}",
  "row.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}",
  "row.requestFailed": "\u8BF7\u6C42\u5931\u8D25\uFF1A{detail}",
  "row.rejected": "\u5BBF\u4E3B\u62D2\u7EDD\u4E86\u8FD9\u6B21\u4FDD\u5B58\uFF08\u7248\u672C\u51B2\u7A81\u6216\u5B57\u6BB5\u4E0D\u53EF\u7F16\u8F91\uFF09\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002",
  "row.unavailable": "\u5BBF\u4E3B\u8BBE\u7F6E\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u3002"
};
var en = {
  "row.title": "Terminal tool",
  "row.description": "The terminal the model runs commands in; changes apply to new sessions only.",
  "row.dialect.label": "Terminal kind",
  "row.dialect.pwsh": "PowerShell (pwsh)",
  "row.dialect.bash": "Git Bash (bash)",
  "row.path.label": "Git Bash path",
  "row.path.placeholder": "e.g. C:/Program Files/Git/bin/bash.exe",
  "row.path.none": "Not chosen",
  "row.path.missing": 'Choose "Auto-detect" to scan this machine, or type the full path to bash.exe.',
  "row.confined.label": "Under a confined sandbox",
  "row.confined.description": "The Windows sandbox drops commands to low integrity, where Git Bash cannot start; this decides what happens then.",
  "row.confined.unconfined": "Run directly (no sandbox)",
  "row.confined.escalate": "Confined, escalate on failure",
  "row.confined.fail": "Report an error",
  "row.confined.unconfinedNotice": "Note: with this choice, commands the model runs are not file-sandboxed.",
  "row.minimal.label": "Minimal mode",
  "row.minimal.description": `Only affects sessions using the official "minimal" preset: keep its persistent terminal, or hand them to this plugin's bash.`,
  "row.minimal.leave": "Keep the official persistent terminal",
  "row.minimal.oneshot": "Replace with a one-shot bash",
  "row.minimal.variant": "Add a Git Bash variant",
  "row.minimal.variantReady": 'Added "{id}" to the preset list; pick it when creating a session.',
  "row.minimal.variantRetained": '{count} session(s) still use "{id}", so it stays registered; they can still be reopened.',
  "row.minimal.variantFailed": "Could not add the variant: {reason}",
  "row.discover": "Auto-detect",
  "row.discovering": "Scanning\u2026",
  "row.foundNone": "No Git Bash found. Type the full path to bash.exe.",
  "row.notSupported": "Not supported by this DSH version: {reason}",
  "row.saveFailed": "Save failed: {message}",
  "row.requestFailed": "Request failed: {detail}",
  "row.rejected": "The host rejected this save (version conflict or a non-editable field). Refresh and retry.",
  "row.unavailable": "The host settings service is unavailable, so changes cannot be saved."
};

// src/client/row.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/shared/protocol.ts
var SETTINGS_NAMESPACE = "terminal-tool";
var ROUTE_STATE = "/api/dsh-terminal-tool/state";
var ROUTE_DISCOVER = "/api/dsh-terminal-tool/discover";

// src/client/api.ts
var RouteError = class extends Error {
  detail;
  constructor(detail) {
    super(detail);
    this.name = "RouteError";
    this.detail = detail;
  }
};
async function post(path, body, signal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new RouteError(`HTTP ${String(response.status)}`);
  const payload = await response.json();
  if (payload !== null && typeof payload === "object" && payload.ok === false) {
    const message = payload.error;
    throw new RouteError(typeof message === "string" ? message : "no detail");
  }
  return payload;
}
function fetchState(signal) {
  return post(ROUTE_STATE, {}, signal);
}
function fetchCandidates(saved, signal) {
  return post(ROUTE_DISCOVER, saved === void 0 || saved === "" ? {} : { bashPath: saved }, signal);
}

// src/client/store.ts
var INITIAL_ROW_STATE = {
  status: "loading",
  platform: "",
  dialect: "pwsh",
  confinedPolicy: "unconfined",
  minimalMode: "oneshot",
  variant: { status: "absent", id: "minimal-gitbash", refs: 0 },
  bashPath: "",
  savedCandidates: [],
  scanned: [],
  writable: false,
  settingsAvailable: false,
  supported: false,
  discovering: false,
  saving: false
};
function shallowEqual(left, right) {
  if (Object.is(left, right)) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.is(Reflect.get(left, key), Reflect.get(right, key)));
}
function createStore(initial) {
  let state = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState(patch) {
      const next = { ...state, ...patch };
      if (shallowEqual(state, next)) return;
      state = next;
      for (const listener of [...listeners]) listener();
    }
  };
}
function pathKey(path) {
  return path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}
function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}
function knownPaths(state) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const candidate of [state.bashPath, ...state.scanned, ...state.savedCandidates]) {
    const trimmed = candidate.trim();
    if (trimmed === "") continue;
    const key = pathKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function requestError(translate, error) {
  return translate("row.requestFailed", { detail: messageOf(error) });
}
function normalizeConfinedPolicy(value) {
  return value === "escalate" || value === "fail" ? value : "unconfined";
}
function normalizeMinimalMode(value) {
  return value === "leave" || value === "variant" ? value : "oneshot";
}
function createRowController(scope, translate) {
  const store = createStore(INITIAL_ROW_STATE);
  let settingsReady = false;
  const syncSettings = () => {
    if (scope === void 0) return;
    const snapshot = scope.getSnapshot();
    const value = snapshot.value;
    if (value !== void 0) settingsReady = true;
    store.setState({
      writable: snapshot.writable && snapshot.status === "ready",
      ...value === void 0 ? {} : {
        dialect: value.dialect === "bash" ? "bash" : "pwsh",
        confinedPolicy: normalizeConfinedPolicy(value.confinedPolicy),
        minimalMode: normalizeMinimalMode(value.minimalMode),
        bashPath: value.bashPath ?? "",
        savedCandidates: value.bashCandidates ?? []
      }
    });
  };
  const write = (ops) => {
    if (scope === void 0) {
      store.setState({ saving: false, error: translate("row.unavailable") });
      return;
    }
    store.setState({ saving: true });
    void scope.mutate(ops).then((accepted) => {
      if (accepted === false) {
        store.setState({ saving: false, error: translate("row.rejected") });
        return;
      }
      store.setState({ saving: false, error: void 0 });
    }).catch((error) => {
      store.setState({ saving: false, error: translate("row.saveFailed", { message: messageOf(error) }) });
    });
  };
  const setDialect = (dialect) => {
    store.setState({ dialect, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["dialect"], value: dialect }]);
  };
  const setConfinedPolicy = (policy) => {
    store.setState({ confinedPolicy: policy, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["confinedPolicy"], value: policy }]);
  };
  const setMinimalMode = (mode) => {
    store.setState({ minimalMode: mode, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["minimalMode"], value: mode }]);
  };
  const setBashPath = (path) => {
    const trimmed = path.trim();
    store.setState({ bashPath: trimmed, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["bashPath"], value: trimmed }]);
  };
  const discover = () => {
    const current = store.getState().bashPath;
    store.setState({ discovering: true, error: void 0, notice: void 0 });
    void fetchCandidates(current).then((view) => {
      const usable = [];
      for (const candidate of view.candidates) {
        if (!candidate.valid) continue;
        if (usable.some((path) => samePath(path, candidate.path))) continue;
        usable.push(candidate.path);
      }
      if (usable.length === 0) {
        store.setState({ discovering: false, scanned: [], notice: translate("row.foundNone") });
        return;
      }
      const picked = current.trim().length > 0 && usable.some((path) => samePath(path, current)) ? current : usable[0];
      store.setState({ discovering: false, scanned: usable, bashPath: picked, notice: void 0 });
      write([
        { op: "set", path: ["bashPath"], value: picked },
        { op: "set", path: ["bashCandidates"], value: usable }
      ]);
    }).catch((error) => {
      store.setState({ discovering: false, error: requestError(translate, error) });
    });
  };
  const start = () => {
    let active = true;
    const disposers = [];
    if (scope !== void 0) {
      syncSettings();
      disposers.push(scope.subscribe(syncSettings));
    }
    void fetchState().then((state) => {
      if (!active) return;
      store.setState({
        platform: state.platform,
        settingsAvailable: state.settingsAvailable,
        supported: state.capability.supported,
        ...state.capability.reason === void 0 ? {} : { unsupportedReason: state.capability.reason },
        // The form's value wins whenever it has arrived; `/state` is the
        // fallback for the brief window before the describe mirror loads.
        ...settingsReady ? {} : {
          dialect: state.dialect,
          bashPath: state.bashPath,
          minimalMode: normalizeMinimalMode(state.minimalMode)
        },
        // The variant lifecycle is Host-owned: never cached across a mount.
        // A Host that predates the field has none, so keep the empty state
        // rather than letting the row render against undefined.
        ...state.variant === void 0 ? {} : { variant: state.variant },
        status: state.platform === "win32" ? "ready" : "hidden"
      });
    }).catch((error) => {
      if (!active) return;
      store.setState({
        status: "ready",
        supported: false,
        error: requestError(translate, error)
      });
    });
    return () => {
      active = false;
      for (const dispose of disposers) dispose();
    };
  };
  return { store, start, setDialect, setConfinedPolicy, setMinimalMode, setBashPath, discover };
}

// src/client/row.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var PATH_CONTROL_ID = "dsh-terminal-tool-path";
function useStoreState(controller) {
  return (0, import_react.useSyncExternalStore)(controller.store.subscribe, controller.store.getState);
}
function Selector(props) {
  const [open, setOpen] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.Menu,
    {
      open,
      onClose: () => setOpen(false),
      items: props.items,
      selectedId: props.selectedId,
      onSelect: (id) => {
        setOpen(false);
        props.onSelect(id);
      },
      align: "end",
      portal: true,
      className: props.className,
      anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "tterm-selector",
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-label": props.label,
          disabled: props.disabled,
          onClick: () => setOpen((current) => !current),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tterm-selector-value", children: props.value }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { className: "tterm-chevron" })
          ]
        }
      )
    }
  );
}
function TerminalToolRow({ t, form }) {
  const [controller] = (0, import_react.useState)(() => createRowController(form, t));
  const state = useStoreState(controller);
  const [draft, setDraft] = (0, import_react.useState)(state.bashPath);
  (0, import_react.useEffect)(() => controller.start(), [controller]);
  (0, import_react.useEffect)(() => {
    setDraft(state.bashPath);
  }, [state.bashPath]);
  if (state.status !== "ready") return null;
  const controlsEnabled = state.writable && state.supported && !state.saving && !state.discovering;
  const dialect = state.dialect === "bash" ? "bash" : "pwsh";
  const bashPath = state.bashPath.trim();
  const paths = knownPaths(state);
  const commitPath = () => {
    const next = draft.trim();
    if (next === bashPath) return;
    controller.setBashPath(next);
  };
  const dialectItems = [
    { id: "pwsh", label: t("row.dialect.pwsh") },
    { id: "bash", label: t("row.dialect.bash") }
  ];
  const pathItems = paths.map((path) => ({ id: path, label: path }));
  const confinedItems = [
    { id: "unconfined", label: t("row.confined.unconfined") },
    { id: "escalate", label: t("row.confined.escalate") },
    { id: "fail", label: t("row.confined.fail") }
  ];
  const minimalItems = [
    { id: "leave", label: t("row.minimal.leave") },
    { id: "oneshot", label: t("row.minimal.oneshot") },
    { id: "variant", label: t("row.minimal.variant") }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-group", "data-dsh-terminal-tool": "row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-title", children: t("row.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.description") }),
        state.supported ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", children: t("row.notSupported", { reason: state.unsupportedReason ?? "" }) }),
        state.settingsAvailable ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", children: t("row.unavailable") }),
        state.notice === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "status", children: state.notice }),
        state.error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-error", role: "alert", children: state.error })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Selector,
        {
          className: "tterm-dialect",
          label: t("row.dialect.label"),
          value: t(dialect === "bash" ? "row.dialect.bash" : "row.dialect.pwsh"),
          items: dialectItems,
          selectedId: dialect,
          disabled: !controlsEnabled,
          onSelect: (id) => {
            const next = id === "bash" ? "bash" : "pwsh";
            if (next !== dialect) controller.setDialect(next);
          }
        }
      )
    ] }),
    dialect === "bash" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-field-label", children: t("row.path.label") }),
          bashPath === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", children: t("row.path.missing") }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-path-control", children: [
          paths.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            Selector,
            {
              className: "tterm-path-selector",
              label: t("row.path.label"),
              value: bashPath === "" ? t("row.path.none") : bashPath,
              items: pathItems,
              selectedId: bashPath,
              disabled: !controlsEnabled,
              onSelect: (path) => {
                if (path !== bashPath) controller.setBashPath(path);
              }
            }
          ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_dsh_client_ui_primitives.Input,
            {
              id: PATH_CONTROL_ID,
              className: "tterm-path-input",
              type: "text",
              spellCheck: false,
              autoComplete: "off",
              "aria-label": t("row.path.label"),
              placeholder: t("row.path.placeholder"),
              value: draft,
              disabled: !controlsEnabled,
              onChange: (event) => setDraft(event.target.value),
              onBlur: commitPath,
              onKeyDown: (event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPath();
                }
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled: !controlsEnabled, onClick: () => controller.discover(), children: state.discovering ? t("row.discovering") : t("row.discover") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-field-label", children: t("row.confined.label") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.confined.description") }),
          state.confinedPolicy === "unconfined" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "note", children: t("row.confined.unconfinedNotice") }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          Selector,
          {
            className: "tterm-dialect",
            label: t("row.confined.label"),
            value: t(`row.confined.${state.confinedPolicy}`),
            items: confinedItems,
            selectedId: state.confinedPolicy,
            disabled: !controlsEnabled,
            onSelect: (id) => {
              const next = id === "escalate" ? "escalate" : id === "fail" ? "fail" : "unconfined";
              if (next !== state.confinedPolicy) controller.setConfinedPolicy(next);
            }
          }
        )
      ] }),
      state.supported ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-field-label", children: t("row.minimal.label") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.minimal.description") }),
          state.variant?.status === "registered" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "note", children: t("row.minimal.variantReady", { id: state.variant.id }) }) : state.variant?.status === "retained" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "note", children: t("row.minimal.variantRetained", {
            id: state.variant.id,
            count: String(state.variant.refs)
          }) }) : state.variant?.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-error", role: "alert", children: t("row.minimal.variantFailed", { reason: state.variant.reason ?? "" }) }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          Selector,
          {
            className: "tterm-dialect",
            label: t("row.minimal.label"),
            value: t(`row.minimal.${state.minimalMode}`),
            items: minimalItems,
            selectedId: state.minimalMode,
            disabled: !controlsEnabled,
            onSelect: (id) => {
              const next = id === "leave" ? "leave" : id === "variant" ? "variant" : "oneshot";
              if (next !== state.minimalMode) controller.setMinimalMode(next);
            }
          }
        )
      ] }) : null
    ] }) : null
  ] });
}

// src/client/index.ts
var GENERAL_ITEM_ID = "terminal-tool";
var GENERAL_ITEM_ORDER = 60;
var inject = ["slots", "locale"];
var unseat;
var seatedForm;
function service(ctx, name) {
  const found = ctx.get(name);
  return found === void 0 || found === null ? void 0 : found;
}
function nativeForm(ctx) {
  const forms = service(ctx, "configForms");
  if (forms === void 0) return void 0;
  try {
    return forms.get(SETTINGS_NAMESPACE);
  } catch {
    return void 0;
  }
}
function seatRow(ctx, slots, t, form) {
  if (unseat !== void 0 && seatedForm === form) return;
  unseat?.();
  unseat = void 0;
  seatedForm = form;
  ctx.effect(() => {
    let dispose;
    const off = slots.inject("settings.general.item", () => {
      dispose = slots.register(
        {
          name: "settings.general.item",
          id: GENERAL_ITEM_ID,
          order: GENERAL_ITEM_ORDER,
          locale: LOCALE_NAMESPACE,
          inject: () => ({ t, form })
        },
        TerminalToolRow
      );
      unseat = () => {
        const current = dispose;
        dispose = void 0;
        unseat = void 0;
        current?.();
      };
    });
    return () => {
      unseat = void 0;
      seatedForm = void 0;
      const current = dispose;
      dispose = void 0;
      current?.();
      off();
    };
  }, "terminal-tool: settings row");
}
function apply(ctx) {
  const locale = service(ctx, "locale");
  const slots = service(ctx, "slots");
  if (slots === void 0) return;
  if (locale !== void 0) {
    ctx.effect(() => {
      try {
        return locale.register(LOCALE_NAMESPACE, { zh, en });
      } catch {
        return void 0;
      }
    }, "terminal-tool: locale");
  }
  const t = locale?.bind(LOCALE_NAMESPACE) ?? ((key) => key);
  const form = nativeForm(ctx);
  seatRow(ctx, slots, t, form);
  if (form === void 0) {
    ctx.inject(["configForms"], (scoped) => {
      const late = nativeForm(scoped);
      if (late === void 0) return;
      seatRow(scoped, slots, t, late);
    });
  }
}
return module.exports; } });
//# sourceMappingURL=client.js.map
