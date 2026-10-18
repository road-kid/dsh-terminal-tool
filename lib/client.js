window.__ModuleLoader__.load({ id: "dsh-terminal-tool", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
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
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/row.tsx
var import_react = require("react");

// src/client/styles.ts
var STYLE_TAG_ID = "dsh-terminal-tool-row";
var CSS = `
.tt-row{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;padding:14px 0}
.tt-text{flex:1 1 auto;min-width:0}
.tt-label{font-size:13px;font-weight:600;line-height:1.4}
.tt-desc{margin-top:2px;font-size:12px;line-height:1.5;opacity:.65}
.tt-body{display:flex;flex:0 0 auto;flex-direction:column;gap:8px;width:min(320px,100%)}
.tt-choices{display:flex;gap:6px}
.tt-choice{flex:1 1 0;padding:6px 10px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.tt-choice[aria-checked="true"]{border-color:transparent;background:color-mix(in srgb,currentColor 14%,transparent);font-weight:600}
.tt-choice:disabled{opacity:.5;cursor:default}
.tt-field{display:flex;flex-direction:column;gap:4px}
.tt-field-label{font-size:12px;opacity:.75}
.tt-input{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px}
.tt-input:disabled{opacity:.6}
.tt-hint{margin:0;font-size:11px;line-height:1.5;opacity:.6}
.tt-check{display:flex;gap:6px;align-items:center;font-size:12px;opacity:.85}
.tt-error{margin:0;font-size:12px;color:#e5484d}
`.trim();
function applyStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_TAG_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_TAG_ID;
  style.textContent = CSS;
  document.head.append(style);
}

// src/client/row.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function TerminalToolRow({ useSettings, set, t }) {
  applyStyles();
  const snapshot = useSettings((value) => value);
  const [saving, setSaving] = (0, import_react.useState)(false);
  const [failed, setFailed] = (0, import_react.useState)(false);
  const values = snapshot.value;
  const dialect = values?.dialect === "bash" ? "bash" : "pwsh";
  const autoDiscover = values?.autoDiscover ?? true;
  const bashPath = values?.bashPath ?? "";
  const [draft, setDraft] = (0, import_react.useState)(bashPath);
  (0, import_react.useEffect)(() => {
    setDraft(bashPath);
  }, [bashPath]);
  const ready = snapshot.status === "ready" && snapshot.writable && !saving;
  const write = async (field, value) => {
    setSaving(true);
    setFailed(false);
    try {
      if (!await set(field, value)) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const commitPath = () => {
    const next = draft.trim();
    if (next !== bashPath) void write("bashPath", next);
  };
  const choice = (value, label) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      role: "radio",
      "aria-checked": dialect === value,
      className: "tt-choice",
      disabled: !ready,
      onClick: () => {
        if (value !== dialect) void write("dialect", value);
      },
      children: label
    }
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tt-row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tt-text", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tt-label", children: t("title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tt-desc", children: t("description") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tt-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tt-choices", role: "radiogroup", "aria-label": t("title"), children: [
        choice("pwsh", t("pwsh")),
        choice("bash", t("bash"))
      ] }),
      dialect === "bash" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tt-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "tt-field-label", htmlFor: "tt-bash-path", children: t("bashPath") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              id: "tt-bash-path",
              className: "tt-input",
              type: "text",
              spellCheck: false,
              autoComplete: "off",
              placeholder: t("bashPathPlaceholder"),
              value: draft,
              disabled: !ready,
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
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tt-hint", children: t("bashPathHint") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "tt-check", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked: autoDiscover,
              disabled: !ready,
              onChange: (event) => void write("autoDiscover", event.target.checked)
            }
          ),
          t("autoDiscover")
        ] })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tt-hint", children: saving ? t("saving") : t("newSessionOnly") }),
      failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tt-error", children: t("saveFailed") }) : null
    ] })
  ] });
}

// src/client/locales.ts
var LOCALE_NAMESPACE = "terminal-tool";
var en = {
  title: "Terminal tool",
  description: "Choose which shell backs the model\u2019s terminal tool. Git Bash mounts a bash tool for the session and removes pwsh from it.",
  pwsh: "PowerShell",
  bash: "Git Bash",
  bashPath: "Git Bash path",
  bashPathPlaceholder: "Detect automatically",
  bashPathHint: "Leave empty to auto-discover Git Bash. A configured path is used as-is.",
  autoDiscover: "Auto-discover when the path is empty",
  newSessionOnly: "Applies to new sessions only.",
  saving: "Saving\u2026",
  saveFailed: "The host refused the change. Try again."
};
var zh = {
  title: "\u7EC8\u7AEF\u5DE5\u5177",
  description: "\u9009\u62E9\u6A21\u578B\u7EC8\u7AEF\u5DE5\u5177\u4F7F\u7528\u7684 shell\u3002\u5207\u6362\u5230 Git Bash \u540E\uFF0C\u4F1A\u8BDD\u4F1A\u6302\u8F7D bash \u5DE5\u5177\u5E76\u79FB\u9664 pwsh\u3002",
  pwsh: "PowerShell",
  bash: "Git Bash",
  bashPath: "Git Bash \u8DEF\u5F84",
  bashPathPlaceholder: "\u81EA\u52A8\u68C0\u6D4B",
  bashPathHint: "\u7559\u7A7A\u5219\u81EA\u52A8\u53D1\u73B0 Git Bash\uFF1B\u586B\u5199\u540E\u6309\u586B\u5199\u7684\u8DEF\u5F84\u4F7F\u7528\u3002",
  autoDiscover: "\u8DEF\u5F84\u4E3A\u7A7A\u65F6\u81EA\u52A8\u53D1\u73B0",
  newSessionOnly: "\u4EC5\u5BF9\u65B0\u4F1A\u8BDD\u751F\u6548\u3002",
  saving: "\u6B63\u5728\u4FDD\u5B58\u2026",
  saveFailed: "Host \u62D2\u7EDD\u4E86\u8FD9\u6B21\u4FEE\u6539\uFF0C\u8BF7\u91CD\u8BD5\u3002"
};

// src/client/index.ts
var name = "terminal-tool";
var inject = ["slots", "locale", "configForms"];
var ENTRY_ID = "terminal-tool";
var ROW_ORDER = 60;
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }));
  const form = ctx.configForms.get(ENTRY_ID);
  ctx.effect(
    () => ctx.configForms.whileServed([ENTRY_ID], () => {
      ctx.slots.inject("settings.general.item", () => {
        ctx.slots.register(
          {
            name: "settings.general.item",
            id: ENTRY_ID,
            order: ROW_ORDER,
            locale: LOCALE_NAMESPACE,
            inject: () => ({
              hooks: { settings: form },
              set: (field, value) => form.set(field, value)
            })
          },
          TerminalToolRow
        );
      });
    })
  );
}
return module.exports; } });
//# sourceMappingURL=client.js.map
