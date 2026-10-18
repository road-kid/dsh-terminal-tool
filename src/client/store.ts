import { fetchCandidates, fetchState } from './api.ts'
import type { ConfigFormLike, FieldOp, FormSnapshot, TerminalToolValues, Translate } from './types.ts'

/**
 * Row state machine.
 *
 * Three rules shape this file, and they are all about *not* surprising the user:
 *
 * 1. **The plugin never switches the tool by itself.** `dialect` is written only
 *    when a chip is clicked; the value shown otherwise comes from the Host (the
 *    schema default is `pwsh`). Mounting performs no scan and no write.
 * 2. **Discovery is a user action.** `/discover` runs only when 自动发现 is
 *    clicked, and the chosen path plus the usable list are persisted together.
 * 3. **An existing usable path is never rewritten.** The sweep replaces the
 *    selection only when the current one is not among the usable candidates.
 *
 * `/state` is read once on mount and never scans, so opening Settings stays
 * instant even on a machine with many candidate roots.
 */

/** Which terminal tool a session gets. */
export type Dialect = 'pwsh' | 'bash'

/** Coarse lifecycle of the row. */
export type RowStatus = 'loading' | 'hidden' | 'ready'

/** Everything the row renders from. */
export interface RowState {
  readonly status: RowStatus
  readonly platform: string
  readonly dialect: Dialect
  readonly bashPath: string
  readonly savedCandidates: readonly string[]
  readonly scanned: readonly string[]
  readonly writable: boolean
  readonly settingsAvailable: boolean
  readonly supported: boolean
  readonly unsupportedReason?: string | undefined
  readonly discovering: boolean
  readonly saving: boolean
  readonly error?: string | undefined
  readonly notice?: string | undefined
}

/** Minimal observable store (the row reads it through `useSyncExternalStore`). */
export interface Store<T> {
  getState(): T
  subscribe(listener: () => void): () => void
  setState(patch: Partial<T>): void
}

/** What the component drives. */
export interface RowController {
  readonly store: Store<RowState>
  /** Read `/state` and start following the form; returns the disposer. */
  start(): () => void
  setDialect(dialect: Dialect): void
  setBashPath(path: string): void
  discover(): void
}

/** Initial state: nothing known yet, and the default keeps sessions on pwsh. */
export const INITIAL_ROW_STATE: RowState = {
  status: 'loading',
  platform: '',
  dialect: 'pwsh',
  bashPath: '',
  savedCandidates: [],
  scanned: [],
  writable: false,
  settingsAvailable: false,
  supported: false,
  discovering: false,
  saving: false,
}

/** Shallow equality over own enumerable keys. */
function shallowEqual<T extends object>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) => Object.is(Reflect.get(left, key), Reflect.get(right, key)))
}

/**
 * Create a store that only replaces its state object when a value actually
 * changed — `useSyncExternalStore` re-renders on every identity change, so a
 * no-op `setState` must not allocate.
 */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setState(patch) {
      const next = { ...state, ...patch }
      if (shallowEqual(state, next)) return
      state = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Comparison key for a bash path: separators, trailing slash and case folded. */
function pathKey(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** Whether two paths point at the same executable. */
export function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

/** Every path worth offering in the picker, deduplicated, in priority order. */
export function knownPaths(state: RowState): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of [state.bashPath, ...state.scanned, ...state.savedCandidates]) {
    const trimmed = candidate.trim()
    if (trimmed === '') continue
    const key = pathKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/** `Error`-ish values to a one-line message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the controller for one mounted row.
 *
 * @param scope - the entry's `configForms` form, or `undefined` when the Host
 *   settings service is absent (the row then renders read-only with an
 *   explanation instead of pretending to save).
 * @param translate - locale-bound `t`.
 */
export function createRowController(
  scope: ConfigFormLike<TerminalToolValues> | undefined,
  translate: Translate,
): RowController {
  const store = createStore<RowState>(INITIAL_ROW_STATE)

  /** Whether the form has delivered a value at least once. */
  let settingsReady = false

  /** Mirror the form's snapshot into the row state. */
  const syncSettings = (): void => {
    if (scope === undefined) return
    const snapshot: FormSnapshot<TerminalToolValues> = scope.getSnapshot()
    const value = snapshot.value
    if (value !== undefined) settingsReady = true
    store.setState({
      writable: snapshot.writable && snapshot.status === 'ready',
      ...(value === undefined
        ? {}
        : {
            dialect: value.dialect === 'bash' ? ('bash' as const) : ('pwsh' as const),
            bashPath: value.bashPath ?? '',
            savedCandidates: value.bashCandidates ?? [],
          }),
    })
  }

  /** Persist a batch of field writes, surfacing the outcome in the row. */
  const write = (ops: readonly FieldOp[]): void => {
    if (scope === undefined) {
      store.setState({ saving: false, error: translate('row.unavailable') })
      return
    }
    store.setState({ saving: true })
    void scope
      .mutate(ops)
      .then((accepted) => {
        if (accepted === false) {
          store.setState({ saving: false, error: translate('row.rejected') })
          return
        }
        store.setState({ saving: false, error: undefined })
      })
      .catch((error: unknown) => {
        store.setState({ saving: false, error: translate('row.saveFailed', { message: messageOf(error) }) })
      })
  }

  const setDialect = (dialect: Dialect): void => {
    // Optimistic: the chip must feel instant; a rejection restores the value on
    // the next form snapshot and shows an error.
    store.setState({ dialect, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['dialect'], value: dialect }])
  }

  const setBashPath = (path: string): void => {
    const trimmed = path.trim()
    store.setState({ bashPath: trimmed, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['bashPath'], value: trimmed }])
  }

  const discover = (): void => {
    const current = store.getState().bashPath
    store.setState({ discovering: true, error: undefined, notice: undefined })
    void fetchCandidates(current)
      .then((view) => {
        const usable: string[] = []
        for (const candidate of view.candidates) {
          if (!candidate.valid) continue
          if (usable.some((path) => samePath(path, candidate.path))) continue
          usable.push(candidate.path)
        }
        if (usable.length === 0) {
          store.setState({ discovering: false, scanned: [], notice: translate('row.foundNone') })
          return
        }
        // Keep the user's current choice when the sweep still considers it
        // usable; only a missing/invalid path is replaced.
        const picked =
          current.trim().length > 0 && usable.some((path) => samePath(path, current)) ? current : usable[0]!
        store.setState({ discovering: false, scanned: usable, bashPath: picked, notice: undefined })
        write([
          { op: 'set', path: ['bashPath'], value: picked },
          { op: 'set', path: ['bashCandidates'], value: usable },
        ])
      })
      .catch((error: unknown) => {
        store.setState({ discovering: false, error: messageOf(error) })
      })
  }

  /** Read `/state` and follow the form; returns the teardown. */
  const start = (): (() => void) => {
    let active = true
    const disposers: (() => void)[] = []

    if (scope !== undefined) {
      syncSettings()
      disposers.push(scope.subscribe(syncSettings))
    }

    void fetchState()
      .then((state) => {
        if (!active) return
        store.setState({
          platform: state.platform,
          settingsAvailable: state.settingsAvailable,
          supported: state.capability.supported,
          ...(state.capability.reason === undefined ? {} : { unsupportedReason: state.capability.reason }),
          // The form's value wins whenever it has arrived; `/state` is the
          // fallback for the brief window before the describe mirror loads.
          ...(settingsReady ? {} : { dialect: state.dialect, bashPath: state.bashPath }),
          status: state.platform === 'win32' ? 'ready' : 'hidden',
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        // Without `/state` the platform is unknown. Assuming win32 keeps the row
        // visible (with an error) instead of silently hiding a broken install;
        // the component still hides itself when it learns the platform.
        store.setState({
          status: 'ready',
          supported: false,
          error: messageOf(error),
        })
      })

    return () => {
      active = false
      for (const dispose of disposers) dispose()
    }
  }

  return { store, start, setDialect, setBashPath, discover }
}
