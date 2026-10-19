/**
 * Structural contracts for the client half.
 *
 * Everything here is *shaped*, not imported: typing the cordis services
 * structurally keeps this package independent of their internal declaration
 * layout, and each interface lists only what this plugin actually calls. (The
 * one first-party import in the bundle is the official UI atoms — the Web shell
 * seeds `@deepseek-ai/dsh-client-ui-primitives` into its frozen module table, so
 * requiring it costs nothing and yields the official button/input/menu markup.
 * Every other cross-plugin value import stays forbidden.)
 */

/** A snapshot of the settings form, as the first-party `configForms` reports it. */
export interface FormSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'error'
  readonly value: T | undefined
  readonly revision: number | undefined
  readonly writable: boolean
}

/** One field operation inside a namespace mutation. */
export interface FieldOp {
  readonly op: 'set' | 'unset'
  readonly path: readonly string[]
  readonly value?: unknown
}

/**
 * The subset of `ConfigFormController` this row uses.
 *
 * `mutate` is what makes an atomic multi-field write possible: choosing a
 * discovered path persists `bashPath` and `bashCandidates` in one revision, so
 * a concurrent reader never observes a half-updated pair.
 */
export interface ConfigFormLike<T> {
  getSnapshot(): FormSnapshot<T>
  subscribe(listener: () => void): () => void
  mutate(ops: readonly FieldOp[], expectedRevision?: number): Promise<boolean>
}

/** Values this plugin stores in its own entry Config. */
export interface TerminalToolValues {
  readonly dialect?: 'pwsh' | 'bash'
  readonly bashPath?: string
  readonly bashCandidates?: readonly string[]
}

/** A locale dictionary. */
export type Dictionary = Readonly<Record<string, string>>

/** What `slots.register` accepts (only the keys used here). */
export interface SlotRegistration {
  readonly name: string
  readonly id: string
  readonly order?: number
  readonly locale?: string
  readonly inject?: () => unknown
}

/** Translate function bound to this plugin's locale namespace. */
export type Translate = (key: string, params?: Record<string, string>) => string

/** The face the slot's `inject` hands the row. */
export interface RowFace {
  readonly t: Translate
  readonly form: ConfigFormLike<TerminalToolValues> | undefined
}

/** Props the slots runtime passes to the row component. */
export type RowProps = RowFace

/** The subset of `ctx.configForms` used here. */
export interface ConfigFormsService {
  get<T>(entryId: string): ConfigFormLike<T>
  whileServed(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void
}

/** The subset of `ctx.slots` used here. */
export interface SlotsService {
  inject(name: string, callback: () => unknown): () => void
  register(registration: SlotRegistration, component: (props: RowProps) => unknown): () => void
}

/** The subset of `ctx.locale` used here. */
export interface LocaleService {
  register(namespace: string, dictionaries: Record<string, Dictionary>): () => void
  bind(namespace: string): Translate
}

/** The client-side cordis context, structurally. */
export interface ClientContext {
  effect(callback: () => unknown, label?: string): void
  get(name: string): unknown
  inject(names: string[], callback: (scoped: ClientContext) => void): void
  readonly locale?: LocaleService | undefined
  readonly slots?: SlotsService | undefined
  readonly configForms?: ConfigFormsService | undefined
}
