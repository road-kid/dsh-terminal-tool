/**
 * Client half of the plugin.
 *
 * The Host row is web-free: it mounts the bash tool into a session. This bundle
 * only supplies the switch the user flips — a `settings.general.item` row that
 * edits the same volatile config the Host reads, through the official
 * `configForms` service, so the write lands in the profile patch layer exactly
 * as a plugin-manager form would.
 */

import { TerminalToolRow } from './row.tsx'
import { en, LOCALE_NAMESPACE, zh } from './locales.ts'
import type { ClientContext, TerminalToolValues } from './types.ts'

export const name = 'terminal-tool'

/** Services this bundle must have before it can register its row. */
export const inject = ['slots', 'locale', 'configForms']

/** The Host plugin entry id: the row id this bundle's patch declares. */
const ENTRY_ID = 'terminal-tool'

/** Row order inside the General section, after the built-in developer tools row. */
const ROW_ORDER = 60

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { en, zh }))

  const form = ctx.configForms.get<TerminalToolValues>(ENTRY_ID)

  // Only register once the Host actually serves this namespace, so a build of
  // the plugin whose Host row failed to activate shows no dead switch.
  ctx.effect(() =>
    ctx.configForms.whileServed([ENTRY_ID], () => {
      ctx.slots.inject('settings.general.item', () => {
        ctx.slots.register(
          {
            name: 'settings.general.item',
            id: ENTRY_ID,
            order: ROW_ORDER,
            locale: LOCALE_NAMESPACE,
            inject: () => ({
              hooks: { settings: form },
              set: (field: string, value: unknown) => form.set(field, value),
            }),
          },
          TerminalToolRow,
        )
      })
    }),
  )
}
