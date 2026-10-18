/**
 * Row styles, injected once per page.
 *
 * The client bundle is served as a single script with no sidecar CSS request, so
 * the sheet travels as a string. Every colour is a `--dsw-alias-*` design token:
 * those are what the surrounding General section uses, so the row follows the
 * theme (light/dark/system) without reading it, and the chips line up with the
 * official controls next to them.
 */

/** Marker attribute used to find (and reuse) the injected sheet after HMR. */
export const STYLE_TAG_ID = 'dsh-terminal-tool/row.css'

const CSS = `
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
