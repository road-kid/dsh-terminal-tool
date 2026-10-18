/**
 * The slice of the DSH client-plugin contracts this bundle depends on.
 *
 * The client half is loaded by the Host's `dsh-client-modules` loader, which
 * seeds `require` with the page's shared modules (`react`, `react/jsx-runtime`)
 * and hands `apply()` a cordis client context. The first-party client type graph
 * is not published, so the package keeps structural types of exactly the
 * surface it uses instead of depending on those declarations.
 */

/** One namespace's settings snapshot as the Host's describe mirror exposes it. */
export interface FormSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'error'
  readonly value: T | undefined
  readonly writable: boolean
  readonly revision?: number
}

/**
 * A form model exposed to a renderer as a selector hook. The slots runtime turns
 * each `hooks` entry into `use<Name>`; the selector receives the store snapshot
 * and must return the part the component renders.
 */
export type SnapshotHook<T> = (
  selector: (snapshot: FormSnapshot<T>) => FormSnapshot<T>,
) => FormSnapshot<T>

/** The `configForms` service's per-entry form: values, writes, and subscription. */
export interface ConfigFormLike<T> {
  getSnapshot(): FormSnapshot<T>
  subscribe(listener: () => void): () => void
  /** Queue one field write; resolves to whether the Host accepted it. */
  set(field: string, value: unknown): Promise<boolean>
}

/** Values this plugin projects into the General settings row. */
export interface TerminalToolValues {
  readonly dialect?: 'pwsh' | 'bash'
  readonly bashPath?: string
  readonly autoDiscover?: boolean
}

/** Translation dictionary for one locale. */
export type Dictionary = Readonly<Record<string, string>>

/** Options a cell passes when it registers into a slot. */
export interface SlotRegistration {
  readonly name: string
  readonly id: string
  readonly order: number
  readonly locale: string
  readonly inject: () => Record<string, unknown>
}

/** Props the slots runtime passes to the row component. */
export interface RowProps {
  readonly useSettings: SnapshotHook<TerminalToolValues>
  readonly set: (field: string, value: unknown) => Promise<boolean>
  readonly t: (key: string) => string
}

/** The client context surface this bundle registers into. */
export interface ClientContext {
  effect(execute: () => (() => void) | void, label?: string): void
  readonly locale: {
    register(namespace: string, dictionaries: { en: Dictionary; zh: Dictionary }): () => void
  }
  readonly configForms: {
    get<T>(entryId: string): ConfigFormLike<T>
    whileServed(namespaces: readonly string[], register: () => (() => void) | void): () => void
  }
  readonly slots: {
    inject(names: string, callback: () => (() => void) | void): void
    register(options: SlotRegistration, component: (props: RowProps) => unknown): unknown
  }
}
