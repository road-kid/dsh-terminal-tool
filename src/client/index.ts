/**
 * Client half entry point.
 *
 * The bundle is loaded by `dsh-client-modules` as a classic script and calls
 * `apply(ctx)` once per plugin fiber. It contributes exactly one thing: the
 * 设置 → 通用 → 终端工具 row.
 *
 * ### Why `configForms` is not in `inject`
 *
 * A hard dependency that never resolves keeps the entry `pending` forever: the
 * whole plugin then fails to load and the app shows a "waiting for service"
 * banner at boot. The settings channel is therefore looked up with `ctx.get()`
 * and, when it is merely late, picked up through a deferred `ctx.inject([...])`.
 * The row degrades to read-only with an explanation rather than breaking boot.
 */

import { en, LOCALE_NAMESPACE, zh } from './locales.ts'
import { TerminalToolRow } from './row.tsx'
import { SETTINGS_NAMESPACE } from '../shared/protocol.ts'
import type {
  ClientContext,
  ConfigFormLike,
  ConfigFormsService,
  LocaleService,
  SlotsService,
  TerminalToolValues,
  Translate,
} from './types.ts'

/** Slot id of the row inside `settings.general.item`. */
export const GENERAL_ITEM_ID = 'terminal-tool'

/** Order inside the General section, after 对话显示 / 繁忙时的发送行为. */
export const GENERAL_ITEM_ORDER = 60

/** Only hard dependencies: the slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/** Guards against a second registration after a late service or an HMR re-apply. */
let seated = false

/** Look up a service without making it a hard dependency. */
function service<T>(ctx: ClientContext, name: string): T | undefined {
  const found = ctx.get(name)
  return found === undefined || found === null ? undefined : (found as T)
}

/** The entry's form, or `undefined` when this Host has no settings service. */
function nativeForm(ctx: ClientContext): ConfigFormLike<TerminalToolValues> | undefined {
  const forms = service<ConfigFormsService>(ctx, 'configForms')
  if (forms === undefined) return undefined
  try {
    return forms.get<TerminalToolValues>(SETTINGS_NAMESPACE)
  } catch {
    return undefined
  }
}

/**
 * Register the row, once.
 *
 * @param form - the entry form, or `undefined` for a read-only row.
 */
function seatRow(ctx: ClientContext, slots: SlotsService, t: Translate, form: ConfigFormLike<TerminalToolValues> | undefined): void {
  if (seated) return
  seated = true
  ctx.effect(() => {
    slots.inject('settings.general.item', () => {
      slots.register(
        {
          name: 'settings.general.item',
          id: GENERAL_ITEM_ID,
          order: GENERAL_ITEM_ORDER,
          locale: LOCALE_NAMESPACE,
          inject: () => ({ t, form }),
        },
        TerminalToolRow,
      )
    })
  }, 'terminal-tool: settings row')
}

export function apply(ctx: ClientContext): void {
  const locale = service<LocaleService>(ctx, 'locale')
  const slots = service<SlotsService>(ctx, 'slots')
  if (slots === undefined) return

  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        locale.register(LOCALE_NAMESPACE, { zh, en })
      } catch {
        // Namespace already taken — a re-apply after HMR. Reusing the existing
        // dictionary is exactly what we want, so this is not an error.
      }
    }, 'terminal-tool: locale')
  }

  const t: Translate = locale?.bind(LOCALE_NAMESPACE) ?? ((key) => key)

  const form = nativeForm(ctx)
  seatRow(ctx, slots, t, form)

  if (form === undefined) {
    // The settings service may still be loading; upgrade the row when it lands.
    ctx.inject(['configForms'], (scoped) => {
      const late = nativeForm(scoped)
      if (late === undefined) return
      seated = false
      seatRow(scoped, slots, t, late)
    })
  }
}
