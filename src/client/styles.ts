/**
 * Row styles, injected once per page.
 *
 * The client bundle is served as a single script with no sidecar CSS request, so
 * the sheet travels as a string. Colours derive from `currentColor` (mixed with
 * the page surface) so the row follows the active theme without reading it.
 */

export const STYLE_TAG_ID = 'dsh-terminal-tool-row'

const CSS = `
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
`.trim()

/** Inject the stylesheet once; a re-registration after HMR reuses the tag. */
export function applyStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_TAG_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_TAG_ID
  style.textContent = CSS
  document.head.append(style)
}
