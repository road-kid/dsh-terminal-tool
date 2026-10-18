import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'

import { createRowController, knownPaths, type RowController, type RowState } from './store.ts'
import { injectStyles } from './styles.ts'
import type { RowProps } from './types.ts'

/**
 * The 设置 → 通用 → 终端工具 row.
 *
 * Shape (matching the official rows around it, and the reference plugin):
 *
 * ```
 * 终端工具
 * [PowerShell（pwsh）] [Git Bash（bash）]
 * Git Bash 路径  [input | select]  [自动发现]
 * 更改对新会话生效（运行中的会话保持启动时的选择）。
 * ```
 *
 * Deliberate choices:
 *
 * - **Both chips are always clickable.** Disabling "Git Bash" until a path has
 *   been found reads as a broken control; choosing bash first and pressing
 *   自动发现 afterwards is the natural order.
 * - **No candidate list is rendered.** The path control *is* the picker: it
 *   becomes a `<select>` once the sweep found more than one bash.
 * - **Nothing renders until the platform is known** (`status !== 'ready'`
 *   returns null), otherwise the row flashes in and then disappears on Linux.
 */

/** Id of the path control, used by the `<label htmlFor>`. */
const PATH_CONTROL_ID = 'dsh-terminal-tool-path'

/** Follow one store field. */
function useStoreState(controller: RowController): RowState {
  return useSyncExternalStore(controller.store.subscribe, controller.store.getState)
}

/** One dialect chip. */
function Chip(props: {
  readonly label: string
  readonly selected: boolean
  readonly disabled: boolean
  readonly onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className={props.selected ? 'tterm-chip tterm-chip-on' : 'tterm-chip'}
      aria-pressed={props.selected}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

export function TerminalToolRow({ t, form }: RowProps): ReactElement | null {
  // One controller per mounted row: `useState` keeps it stable across renders.
  const [controller] = useState(() => createRowController(form, t))
  const state = useStoreState(controller)

  // The input is uncontrolled between commits: a round trip must not eat
  // keystrokes, so the draft lives in component state and is pushed on blur or
  // Enter. `key` on the input below re-seeds it when the Host value changes.
  const [draft, setDraft] = useState(state.bashPath)
  const started = useRef(false)

  useEffect(() => {
    injectStyles()
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    return controller.start()
  }, [controller])

  useEffect(() => {
    setDraft(state.bashPath)
  }, [state.bashPath])

  // Nothing to show until we know the platform; a Linux/macOS Host hides the
  // row entirely (the plugin's replacement is Windows-only).
  if (state.status !== 'ready') return null

  const controlsEnabled = state.writable && state.supported && !state.saving && !state.discovering
  const bashPath = state.bashPath.trim()
  const paths = knownPaths(state)

  /** Commit the typed path, if it changed. */
  const commitPath = (): void => {
    const next = draft.trim()
    if (next === bashPath) return
    controller.setBashPath(next)
  }

  return (
    <div className="tterm-group" data-dsh-terminal-tool="row">
      <div className="tterm-title">{t('row.title')}</div>

      <div className="tterm-row">
        <Chip
          label={t('row.dialect.pwsh')}
          selected={state.dialect !== 'bash'}
          disabled={!controlsEnabled}
          onClick={() => {
            if (state.dialect !== 'pwsh') controller.setDialect('pwsh')
          }}
        />
        <Chip
          label={t('row.dialect.bash')}
          selected={state.dialect === 'bash'}
          disabled={!controlsEnabled}
          onClick={() => {
            if (state.dialect !== 'bash') controller.setDialect('bash')
          }}
        />
      </div>

      {state.dialect === 'bash' ? (
        <div className="tterm-row">
          <label className="tterm-note" htmlFor={PATH_CONTROL_ID}>
            {t('row.path.label')}
          </label>
          {paths.length > 1 ? (
            <select
              id={PATH_CONTROL_ID}
              className="tterm-input"
              value={bashPath}
              disabled={!controlsEnabled}
              onChange={(event) => controller.setBashPath(event.target.value)}
            >
              {bashPath === '' ? <option value="">{t('row.path.none')}</option> : null}
              {paths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={PATH_CONTROL_ID}
              className="tterm-input"
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder={t('row.path.placeholder')}
              value={draft}
              disabled={!controlsEnabled}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitPath}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitPath()
                }
              }}
            />
          )}
          <button
            type="button"
            className="tterm-button"
            disabled={!controlsEnabled}
            onClick={() => controller.discover()}
          >
            {state.discovering ? t('row.discovering') : t('row.discover')}
          </button>
        </div>
      ) : null}

      {state.dialect === 'bash' && bashPath === '' ? <div className="tterm-note">{t('row.path.missing')}</div> : null}
      {state.supported ? null : (
        <div className="tterm-note">
          {t('row.notSupported', { reason: state.unsupportedReason ?? '' })}
        </div>
      )}
      {state.settingsAvailable ? null : <div className="tterm-note">{t('row.unavailable')}</div>}
      {state.notice === undefined ? null : <div className="tterm-note">{state.notice}</div>}
      {state.error === undefined ? null : <div className="tterm-error">{state.error}</div>}

      <div className="tterm-note">{t('row.newSession')}</div>
    </div>
  )
}
