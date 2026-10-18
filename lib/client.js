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

// src/client/locales.ts
var LOCALE_NAMESPACE = "terminal-tool";
var zh = {
  "row.title": "\u7EC8\u7AEF\u5DE5\u5177",
  "row.dialect.pwsh": "PowerShell\uFF08pwsh\uFF09",
  "row.dialect.bash": "Git Bash\uFF08bash\uFF09",
  "row.path.label": "Git Bash \u8DEF\u5F84",
  "row.path.placeholder": "\u4F8B\u5982 C:/Program Files/Git/bin/bash.exe",
  "row.path.none": "\u5C1A\u672A\u9009\u62E9",
  "row.path.missing": "\u8FD8\u6CA1\u9009 Git Bash \u8DEF\u5F84\uFF1A\u70B9\u300C\u81EA\u52A8\u53D1\u73B0\u300D\u626B\u4E00\u904D\uFF0C\u6216\u76F4\u63A5\u586B\u4E00\u4E2A bash.exe \u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002",
  "row.discover": "\u81EA\u52A8\u53D1\u73B0",
  "row.discovering": "\u6B63\u5728\u626B\u63CF\u2026",
  "row.foundNone": "\u6CA1\u6709\u627E\u5230\u4EFB\u4F55 Git Bash\uFF08\u65E2\u4E0D\u662F Git for Windows\uFF0C\u4E5F\u4E0D\u662F MSYS2/Cygwin\uFF09\u3002",
  "row.newSession": "\u66F4\u6539\u5BF9\u65B0\u4F1A\u8BDD\u751F\u6548\uFF08\u8FD0\u884C\u4E2D\u7684\u4F1A\u8BDD\u4FDD\u6301\u542F\u52A8\u65F6\u7684\u9009\u62E9\uFF09\u3002",
  "row.notSupported": "\u5F53\u524D\u7248\u672C\u4E0D\u652F\u6301\u81EA\u52A8\u5207\u6362\uFF1A{reason}",
  "row.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}",
  "row.rejected": "\u5BBF\u4E3B\u62D2\u7EDD\u4E86\u8FD9\u6B21\u4FDD\u5B58\uFF08revision \u51B2\u7A81\u6216\u5B57\u6BB5\u4E0D\u53EF\u7F16\u8F91\uFF09\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002",
  "row.unavailable": "\u5BBF\u4E3B\u8BBE\u7F6E\u670D\u52A1\u4E0D\u53EF\u7528\uFF08\u8BBE\u7F6E\u65E0\u6CD5\u4FDD\u5B58\uFF09\u3002"
};
var en = {
  "row.title": "Terminal tool",
  "row.dialect.pwsh": "PowerShell (pwsh)",
  "row.dialect.bash": "Git Bash (bash)",
  "row.path.label": "Git Bash path",
  "row.path.placeholder": "e.g. C:/Program Files/Git/bin/bash.exe",
  "row.path.none": "not chosen yet",
  "row.path.missing": 'No Git Bash path yet: click "Auto-detect", or type the absolute path to a bash.exe.',
  "row.discover": "Auto-detect",
  "row.discovering": "Scanning\u2026",
  "row.foundNone": "No Git Bash found (neither Git for Windows nor MSYS2/Cygwin).",
  "row.newSession": "Changes apply to new sessions (running sessions keep the shell they started with).",
  "row.notSupported": "Not supported by this DSH version: {reason}",
  "row.saveFailed": "Save failed: {message}",
  "row.rejected": "The host rejected this save (revision conflict or a non-editable field). Refresh and retry.",
  "row.unavailable": "Host settings service unavailable (settings cannot be saved)."
};

// src/client/row.tsx
var import_react = require("react");

// src/shared/protocol.ts
var SETTINGS_NAMESPACE = "terminal-tool";
var ROUTE_STATE = "/api/dsh-terminal-tool/state";
var ROUTE_DISCOVER = "/api/dsh-terminal-tool/discover";

// src/client/api.ts
async function post(path, body, signal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  const payload = await response.json();
  if (payload !== null && typeof payload === "object" && payload.ok === false) {
    const message = payload.error;
    throw new Error(typeof message === "string" ? message : "request failed");
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
      store.setState({ discovering: false, error: messageOf(error) });
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
        ...settingsReady ? {} : { dialect: state.dialect, bashPath: state.bashPath },
        status: state.platform === "win32" ? "ready" : "hidden"
      });
    }).catch((error) => {
      if (!active) return;
      store.setState({
        status: "ready",
        supported: false,
        error: messageOf(error)
      });
    });
    return () => {
      active = false;
      for (const dispose of disposers) dispose();
    };
  };
  return { store, start, setDialect, setBashPath, discover };
}

// src/client/styles.ts
var STYLE_TAG_ID = "dsh-terminal-tool/row.css";
var CSS = `
.tterm-group{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.tterm-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.tterm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tterm-chip{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:20px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;padding:8px 20px;cursor:pointer}
.tterm-chip:hover:not(:disabled):not(.tterm-chip-on){background:var(--dsw-alias-interactive-bg-hover)}
.tterm-chip-on{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-static-neutral-bluish-400)}
.tterm-chip:disabled{opacity:.45;cursor:not-allowed}
.tterm-input{box-sizing:border-box;flex:1 1 260px;min-width:200px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 10px}
select.tterm-input{cursor:pointer}
select.tterm-input:disabled{cursor:not-allowed}
.tterm-button{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 14px;cursor:pointer}
.tterm-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.tterm-button:disabled{opacity:.45;cursor:not-allowed}
.tterm-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.tterm-error{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary));font-size:12px;line-height:18px}
`.trim();
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return;
  const style = document.createElement("style");
  style.setAttribute("data-plugin-css", STYLE_TAG_ID);
  style.textContent = CSS;
  document.head.append(style);
}

// src/client/row.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var PATH_CONTROL_ID = "dsh-terminal-tool-path";
function useStoreState(controller) {
  return (0, import_react.useSyncExternalStore)(controller.store.subscribe, controller.store.getState);
}
function Chip(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      className: props.selected ? "tterm-chip tterm-chip-on" : "tterm-chip",
      "aria-pressed": props.selected,
      disabled: props.disabled,
      onClick: props.onClick,
      children: props.label
    }
  );
}
function TerminalToolRow({ t, form }) {
  const [controller] = (0, import_react.useState)(() => createRowController(form, t));
  const state = useStoreState(controller);
  const [draft, setDraft] = (0, import_react.useState)(state.bashPath);
  const started = (0, import_react.useRef)(false);
  (0, import_react.useEffect)(() => {
    injectStyles();
  }, []);
  (0, import_react.useEffect)(() => {
    if (started.current) return;
    started.current = true;
    return controller.start();
  }, [controller]);
  (0, import_react.useEffect)(() => {
    setDraft(state.bashPath);
  }, [state.bashPath]);
  if (state.status !== "ready") return null;
  const controlsEnabled = state.writable && state.supported && !state.saving && !state.discovering;
  const bashPath = state.bashPath.trim();
  const paths = knownPaths(state);
  const commitPath = () => {
    const next = draft.trim();
    if (next === bashPath) return;
    controller.setBashPath(next);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-group", "data-dsh-terminal-tool": "row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-title", children: t("row.title") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Chip,
        {
          label: t("row.dialect.pwsh"),
          selected: state.dialect !== "bash",
          disabled: !controlsEnabled,
          onClick: () => {
            if (state.dialect !== "pwsh") controller.setDialect("pwsh");
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Chip,
        {
          label: t("row.dialect.bash"),
          selected: state.dialect === "bash",
          disabled: !controlsEnabled,
          onClick: () => {
            if (state.dialect !== "bash") controller.setDialect("bash");
          }
        }
      )
    ] }),
    state.dialect === "bash" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "tterm-note", htmlFor: PATH_CONTROL_ID, children: t("row.path.label") }),
      paths.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "select",
        {
          id: PATH_CONTROL_ID,
          className: "tterm-input",
          value: bashPath,
          disabled: !controlsEnabled,
          onChange: (event) => controller.setBashPath(event.target.value),
          children: [
            bashPath === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: t("row.path.none") }) : null,
            paths.map((path) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: path, children: path }, path))
          ]
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          id: PATH_CONTROL_ID,
          className: "tterm-input",
          type: "text",
          spellCheck: false,
          autoComplete: "off",
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "tterm-button",
          disabled: !controlsEnabled,
          onClick: () => controller.discover(),
          children: state.discovering ? t("row.discovering") : t("row.discover")
        }
      )
    ] }) : null,
    state.dialect === "bash" && bashPath === "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-note", children: t("row.path.missing") }) : null,
    state.supported ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-note", children: t("row.notSupported", { reason: state.unsupportedReason ?? "" }) }),
    state.settingsAvailable ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-note", children: t("row.unavailable") }),
    state.notice === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-note", children: state.notice }),
    state.error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-error", children: state.error }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-note", children: t("row.newSession") })
  ] });
}

// src/client/index.ts
var GENERAL_ITEM_ID = "terminal-tool";
var GENERAL_ITEM_ORDER = 60;
var inject = ["slots", "locale"];
var seated = false;
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
  if (seated) return;
  seated = true;
  ctx.effect(() => {
    slots.inject("settings.general.item", () => {
      slots.register(
        {
          name: "settings.general.item",
          id: GENERAL_ITEM_ID,
          order: GENERAL_ITEM_ORDER,
          locale: LOCALE_NAMESPACE,
          inject: () => ({ t, form })
        },
        TerminalToolRow
      );
    });
  }, "terminal-tool: settings row");
}
function apply(ctx) {
  const locale = service(ctx, "locale");
  const slots = service(ctx, "slots");
  if (slots === void 0) return;
  if (locale !== void 0) {
    ctx.effect(() => {
      try {
        locale.register(LOCALE_NAMESPACE, { zh, en });
      } catch {
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
      seated = false;
      seatRow(scoped, slots, t, late);
    });
  }
}
return module.exports; } });
//# sourceMappingURL=client.js.map
