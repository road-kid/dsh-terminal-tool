import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  Input,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'

import {
  createRowController,
  knownPaths,
  type Dialect,
  type RowController,
  type RowState,
} from './store.ts'
import type { ConfinedPolicy } from '../confined.ts'
import { injectStyles } from './styles.ts'
import type { RowProps } from './types.ts'

/**
 * The 设置 → 通用 → 终端工具 row.
 *
 * Shape, copied from the two official row types that surround it in the General
 * section:
 *
 * ```
 * 终端工具                                        [PowerShell（pwsh） ▾]
 * 模型执行命令时使用的终端；改动只影响新会话。
 * Git Bash 路径                                   [C:/…/bash.exe     ▾] [自动发现]
 * ```
 *
 * Every control is an official `@deepseek-ai/dsh-client-ui-primitives`
 * component, so buttons, the dropdown trigger, the menu card and its rows are
 * pixel-identical to the neighbouring settings: `Menu` for both enumerated
 * choices (the section renders *every* enumerated preference as a dropdown),
 * `Input` for a hand-typed path, `Button` for 自动发现. This file only owns
 * layout, copy and the two-column row skeleton.
 *
 * Deliberate choices:
 *
 * - **Nothing renders until the platform is known** (`status !== 'ready'`
 *   returns null), otherwise the row flashes in and then disappears on Linux.
 * - **No candidate list is rendered.** The path control *is* the picker: it
 *   becomes a dropdown once the sweep found more than one bash.
 * - **The input is uncontrolled between commits** so a settings round trip
 *   cannot eat keystrokes.
 */

/** Id of the path control, used by the visible label. */
const PATH_CONTROL_ID = 'dsh-terminal-tool-path'

/** Follow one store field. */
function useStoreState(controller: RowController): RowState {
  return useSyncExternalStore(controller.store.subscribe, controller.store.getState)
}

/**
 * One official dropdown: a `PreferenceRow`-style trigger plus a `Menu` card.
 *
 * @param props.value - text shown in the trigger.
 * @param props.items - the menu rows.
 * @param props.selectedId - row drawn as selected.
 * @param props.label - accessible name of the trigger.
 * @param props.disabled - whether the trigger refuses input.
 * @param props.className - layout class on the menu's anchor wrapper.
 * @param props.onSelect - called with the id of the chosen row.
 */
function Selector(props: {
  readonly value: string
  readonly items: readonly MenuEntry[]
  readonly selectedId: string
  readonly label: string
  readonly disabled: boolean
  readonly className: string
  readonly onSelect: (id: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      items={props.items}
      selectedId={props.selectedId}
      onSelect={(id) => {
        setOpen(false)
        props.onSelect(id)
      }}
      align="end"
      portal
      className={props.className}
      anchor={
        <button
          type="button"
          className="tterm-selector"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={props.label}
          disabled={props.disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="tterm-selector-value">{props.value}</span>
          <IconChevronDownOutlineRegular className="tterm-chevron" />
        </button>
      }
    />
  )
}

export function TerminalToolRow({ t, form }: RowProps): ReactElement | null {
  // One controller per mounted row: `useState` keeps it stable across renders.
  const [controller] = useState(() => createRowController(form, t))
  const state = useStoreState(controller)

  // The path draft lives in component state and is pushed on blur or Enter; the
  // effect below re-seeds it whenever the Host value changes.
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
  const dialect: Dialect = state.dialect === 'bash' ? 'bash' : 'pwsh'
  const bashPath = state.bashPath.trim()
  const paths = knownPaths(state)

  /** Commit the typed path, if it changed. */
  const commitPath = (): void => {
    const next = draft.trim()
    if (next === bashPath) return
    controller.setBashPath(next)
  }

  const dialectItems: readonly MenuEntry[] = [
    { id: 'pwsh', label: t('row.dialect.pwsh') },
    { id: 'bash', label: t('row.dialect.bash') },
  ]
  const pathItems: readonly MenuEntry[] = paths.map((path) => ({ id: path, label: path }))
  const confinedItems: readonly MenuEntry[] = [
    { id: 'unconfined', label: t('row.confined.unconfined') },
    { id: 'escalate', label: t('row.confined.escalate') },
    { id: 'fail', label: t('row.confined.fail') },
  ]

  return (
    <div className="tterm-group" data-dsh-terminal-tool="row">
      <div className="tterm-row">
        <div className="tterm-text">
          <div className="tterm-title">{t('row.title')}</div>
          <div className="tterm-description">{t('row.description')}</div>
          {state.supported ? null : (
            <div className="tterm-hint">{t('row.notSupported', { reason: state.unsupportedReason ?? '' })}</div>
          )}
          {state.settingsAvailable ? null : <div className="tterm-hint">{t('row.unavailable')}</div>}
          {state.notice === undefined ? null : <div className="tterm-hint">{state.notice}</div>}
          {state.error === undefined ? null : (
            <div className="tterm-error" role="alert">
              {state.error}
            </div>
          )}
        </div>

        <Selector
          className="tterm-dialect"
          label={t('row.dialect.label')}
          value={t(dialect === 'bash' ? 'row.dialect.bash' : 'row.dialect.pwsh')}
          items={dialectItems}
          selectedId={dialect}
          disabled={!controlsEnabled}
          onSelect={(id) => {
            const next: Dialect = id === 'bash' ? 'bash' : 'pwsh'
            if (next !== dialect) controller.setDialect(next)
          }}
        />
      </div>

      {dialect === 'bash' ? (
        <>
          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.path.label')}</div>
              {bashPath === '' ? <div className="tterm-hint">{t('row.path.missing')}</div> : null}
            </div>

            <div className="tterm-path-control">
              {paths.length > 1 ? (
                <Selector
                  className="tterm-path-selector"
                  label={t('row.path.label')}
                  value={bashPath === '' ? t('row.path.none') : bashPath}
                  items={pathItems}
                  selectedId={bashPath}
                  disabled={!controlsEnabled}
                  onSelect={(path) => {
                    if (path !== bashPath) controller.setBashPath(path)
                  }}
                />
              ) : (
                <Input
                  id={PATH_CONTROL_ID}
                  className="tterm-path-input"
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={t('row.path.label')}
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
              <Button variant="outline" size="sm" disabled={!controlsEnabled} onClick={() => controller.discover()}>
                {state.discovering ? t('row.discovering') : t('row.discover')}
              </Button>
            </div>
          </div>

          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.confined.label')}</div>
              <div className="tterm-description">{t('row.confined.description')}</div>
              {state.confinedPolicy === 'unconfined' ? (
                <div className="tterm-hint" role="note">
                  {t('row.confined.unconfinedNotice')}
                </div>
              ) : null}
            </div>

            <Selector
              className="tterm-dialect"
              label={t('row.confined.label')}
              value={t(`row.confined.${state.confinedPolicy}`)}
              items={confinedItems}
              selectedId={state.confinedPolicy}
              disabled={!controlsEnabled}
              onSelect={(id) => {
                const next: ConfinedPolicy = id === 'escalate' ? 'escalate' : id === 'fail' ? 'fail' : 'unconfined'
                if (next !== state.confinedPolicy) controller.setConfinedPolicy(next)
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
