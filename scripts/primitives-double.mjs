/**
 * Test double for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The shipped client bundle requires the real atoms from the Web shell's frozen
 * module table, so a Node test process has nothing to resolve them from (their
 * published `lib/index.js` also imports the whole markdown/shiki graph, which
 * would drag a dozen packages into the dev dependencies). This module mirrors the
 * contract the row actually uses — its props and the roles/attributes it renders
 * — so `rendertest.mjs` can mount the real bundle in jsdom and assert on
 * behaviour instead of on class names.
 *
 * The parts that matter for the row:
 *
 * - `Input` renders a wrapper span carrying `className` and a native `<input>`
 *   that receives every other prop.
 * - `Button` renders a native `<button>` and forwards its attributes.
 * - `Menu` renders the anchor in place and, while `open`, a `role="menu"` card
 *   whose rows carry `role="menuitem"`. The selected row is drawn with a leading
 *   check icon (the real `MenuItemButton` has no `aria-selected`), activating a
 *   row calls only `onSelect(id)` (the owner closes the menu, not the primitive),
 *   and `portal` renders the card into `document.body` like the real menu does.
 */

/**
 * Build the stub namespace.
 *
 * @param React - the React instance the bundle uses, so elements share one
 *   runtime (hook identity and `act` both depend on it).
 */
import { createRequire } from 'node:module'

/** `react-dom` is CJS-only here; the loader's `require` is emulated through Node. */
const require = createRequire(import.meta.url)

export function primitivesStub(React) {
  const h = React.createElement
  const ReactDOM = require('react-dom')

  /** Official `Button`. */
  function Button({ variant = 'ghost', size = 'md', icon, children, ...rest }) {
    return h('button', { type: 'button', 'data-variant': variant, 'data-size': size, ...rest }, icon, children)
  }

  /** Official `Input`. */
  function Input({ icon, className, ...rest }) {
    return h('span', { className }, icon, h('input', rest))
  }

  /** Official `Menu`. */
  function Menu({ open, anchor, items = [], selectedId, onSelect, className, portal }) {
    const card = open
      ? h(
          'div',
          { role: 'menu' },
          items.map((item) =>
            h(
              'button',
              {
                key: item.id,
                type: 'button',
                role: 'menuitem',
                onClick: () => onSelect?.(item.id),
              },
              item.id === selectedId ? h('svg', { key: 'check', 'aria-hidden': 'true', 'data-check': '' }) : null,
              item.label,
            ),
          ),
        )
      : null
    return h(
      'span',
      { className, 'data-menu-anchor': '' },
      anchor,
      card !== null && portal === true ? ReactDOM.createPortal(card, document.body) : card,
    )
  }

  /** Official `IconChevronDownOutlineRegular` (only its presence is asserted). */
  function IconChevronDownOutlineRegular(props) {
    return h('svg', { 'aria-hidden': 'true', ...props })
  }

  return { Button, Input, Menu, IconChevronDownOutlineRegular }
}
