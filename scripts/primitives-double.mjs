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
 *   whose rows carry `role="menuitem"`; activating a row calls `onSelect(id)` and
 *   then `onClose()` (the real menu unmounts its rows on selection).
 */

/**
 * Build the stub namespace.
 *
 * @param React - the React instance the bundle uses, so elements share one
 *   runtime (hook identity and `act` both depend on it).
 */
export function primitivesStub(React) {
  const h = React.createElement

  /** Official `Button`. */
  function Button({ variant = 'ghost', size = 'md', icon, children, ...rest }) {
    return h('button', { type: 'button', 'data-variant': variant, 'data-size': size, ...rest }, icon, children)
  }

  /** Official `Input`. */
  function Input({ icon, className, ...rest }) {
    return h('span', { className }, icon, h('input', rest))
  }

  /** Official `Menu`. */
  function Menu({ open, anchor, items = [], selectedId, onSelect, onClose, className }) {
    return h(
      'span',
      { className, 'data-menu-anchor': '' },
      anchor,
      open
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
                  'aria-selected': item.id === selectedId ? 'true' : 'false',
                  onClick: () => {
                    onSelect?.(item.id)
                    onClose?.()
                  },
                },
                item.label,
              ),
            ),
          )
        : null,
    )
  }

  /** Official `IconChevronDownOutlineRegular` (only its presence is asserted). */
  function IconChevronDownOutlineRegular(props) {
    return h('svg', { 'aria-hidden': 'true', ...props })
  }

  return { Button, Input, Menu, IconChevronDownOutlineRegular }
}
