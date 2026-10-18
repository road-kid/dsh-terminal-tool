import { useEffect, useState } from 'react'
import { applyStyles } from './styles.ts'
import type { RowProps } from './types.ts'

type Dialect = 'pwsh' | 'bash'

/** The General settings row: pick PowerShell or Git Bash for the terminal tool. */
export function TerminalToolRow({ useSettings, set, t }: RowProps) {
  applyStyles()

  const snapshot = useSettings((value) => value)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const values = snapshot.value
  const dialect: Dialect = values?.dialect === 'bash' ? 'bash' : 'pwsh'
  const autoDiscover = values?.autoDiscover ?? true
  const bashPath = values?.bashPath ?? ''

  // The input is uncontrolled while typing: a round trip must not eat keystrokes.
  const [draft, setDraft] = useState(bashPath)
  useEffect(() => {
    setDraft(bashPath)
  }, [bashPath])

  const ready = snapshot.status === 'ready' && snapshot.writable && !saving

  const write = async (field: string, value: unknown): Promise<void> => {
    setSaving(true)
    setFailed(false)
    try {
      if (!(await set(field, value))) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const commitPath = (): void => {
    const next = draft.trim()
    if (next !== bashPath) void write('bashPath', next)
  }

  const choice = (value: Dialect, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={dialect === value}
      className="tt-choice"
      disabled={!ready}
      onClick={() => {
        if (value !== dialect) void write('dialect', value)
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="tt-row">
      <div className="tt-text">
        <div className="tt-label">{t('title')}</div>
        <div className="tt-desc">{t('description')}</div>
      </div>
      <div className="tt-body">
        <div className="tt-choices" role="radiogroup" aria-label={t('title')}>
          {choice('pwsh', t('pwsh'))}
          {choice('bash', t('bash'))}
        </div>
        {dialect === 'bash' ? (
          <>
            <div className="tt-field">
              <label className="tt-field-label" htmlFor="tt-bash-path">
                {t('bashPath')}
              </label>
              <input
                id="tt-bash-path"
                className="tt-input"
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder={t('bashPathPlaceholder')}
                value={draft}
                disabled={!ready}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commitPath}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitPath()
                  }
                }}
              />
              <p className="tt-hint">{t('bashPathHint')}</p>
            </div>
            <label className="tt-check">
              <input
                type="checkbox"
                checked={autoDiscover}
                disabled={!ready}
                onChange={(event) => void write('autoDiscover', event.target.checked)}
              />
              {t('autoDiscover')}
            </label>
          </>
        ) : null}
        <p className="tt-hint">{saving ? t('saving') : t('newSessionOnly')}</p>
        {failed ? <p className="tt-error">{t('saveFailed')}</p> : null}
      </div>
    </div>
  )
}
