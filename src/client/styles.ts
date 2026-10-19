/**
 * Row layout styles, injected once per page.
 *
 * The client bundle is served as a single script with no sidecar CSS request, so
 * the sheet travels as a string.
 *
 * Everything that already has an official control is rendered by the official
 * component (`@deepseek-ai/dsh-client-ui-primitives`) and styled by the shell's
 * own stylesheet, so this file only carries the *layout* of the row: the
 * two-column skeleton of a General-section row, the text column, and the
 * dropdown trigger copied from the section's `PreferenceRow`. Every colour is a
 * `--dsw-alias-*` design token, so the row follows the theme (light/dark/system)
 * without reading it.
 */

/** Marker attribute used to find (and reuse) the injected sheet after HMR. */
export const STYLE_TAG_ID = 'dsh-terminal-tool/row.css'

const CSS = `
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
`.trim()

/** Inject the stylesheet once; a re-registration after HMR reuses the tag. */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
  const style = document.createElement('style')
  style.setAttribute('data-plugin-css', STYLE_TAG_ID)
  style.textContent = CSS
  document.head.append(style)
}
