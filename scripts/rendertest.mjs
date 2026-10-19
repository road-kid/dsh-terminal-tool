/**
 * Render test: mount the real client bundle in a DOM and drive the row.
 *
 * `rowselftest.mjs` covers the controller's decisions and `clientsmoke.mjs`
 * covers the registration contract, but neither renders JSX. This script loads
 * `lib/client.js` exactly as the page does (`window.__ModuleLoader__.load`),
 * calls `apply()` on a stub context, then mounts the registered component with
 * React 18 in jsdom and drives it through the official controls.
 *
 * It catches the class of bug the other two cannot: a hook order error, a
 * missing `useEffect`, a control that never appears, an `onChange` wired to the
 * wrong handler.
 *
 * The official atoms come from `scripts/primitives-double.mjs`: the shipped
 * bundle requires them from the Web shell's module table, which a Node process
 * does not have.
 *
 * Run with `npm run rendertest`. Needs `react`, `react-dom` and `jsdom`, which
 * are devDependencies only: the shipped bundle keeps react external.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { JSDOM } from 'jsdom'

import { primitivesStub } from './primitives-double.mjs'

const require = createRequire(import.meta.url)

/** The module the shell seeds and the bundle requires instead of bundling. */
const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'

let passed = 0
let failed = 0

async function test(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`ok   ${name}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

// --- page environment ------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
})

// React reads these off the global object, so they have to exist *before*
// `react-dom/client` is imported.
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.KeyboardEvent = dom.window.KeyboardEvent
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = require('react')
const { createRoot } = require('react-dom/client')
const act = React.act

const primitives = primitivesStub(React)

/** Let effects and microtasks settle. */
const settle = () => act(async () => {})

// --- load the bundle the way the page loader does --------------------------

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * Execute the bundle once and return its exports.
 *
 * Each call gets a fresh module instance, like a page reload: `apply()` guards
 * against seating the row twice with a module-level flag, so reusing one
 * instance would make every test after the first a no-op.
 */
function loadBundle() {
  let captured
  const windowStub = {
    __ModuleLoader__: {
      load(entry) {
        captured = entry
      },
    },
  }
  const required = []
  const resolve = (specifier) => {
    required.push(specifier)
    if (specifier === PRIMITIVES) return primitives
    return require(specifier)
  }
  // The bundle is a classic script: run it with `window` bound to our stub and a
  // `require` that resolves react from node_modules (the page seeds the same two
  // modules).
  new Function('window', 'require', source)(windowStub, resolve)
  assert.ok(captured, 'the bundle called __ModuleLoader__.load')
  return { id: captured.id, exports: captured.factory(resolve), required }
}

// --- stub context ----------------------------------------------------------

/** A settings form stub with a fixed snapshot and recorded mutations. */
function formStub(initial) {
  const snapshot = { status: 'ready', value: initial, revision: 1, writable: true }
  const mutations = []
  return {
    mutations,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    async mutate(ops) {
      mutations.push(ops)
      return true
    },
  }
}

/** Wire `apply()` to a stub context and return the registered row component. */
function mountRow({ form, state, discover }) {
  const calls = { registered: [], locale: [] }
  const ctx = {
    effect(callback) {
      callback()
    },
    get(name) {
      if (name === 'slots') {
        return {
          inject(_key, callback) {
            callback()
          },
          register(options, component) {
            calls.registered.push({ options, component })
            return () => {}
          },
        }
      }
      if (name === 'locale') {
        return {
          register(namespace, dictionaries) {
            calls.locale.push({ namespace, dictionaries })
            return () => {}
          },
          bind(namespace) {
            const dictionaries = calls.locale[0]?.dictionaries ?? { zh: {}, en: {} }
            return (key, params) => {
              const template = dictionaries.zh[key] ?? key
              return params === undefined
                ? template
                : template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ''))
            }
          },
        }
      }
      if (name === 'configForms') return { get: () => form }
      return undefined
    },
    inject(_names, callback) {
      callback(ctx)
    },
  }

  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url), 'http://127.0.0.1').pathname
    if (path.endsWith('/discover')) return new Response(JSON.stringify(discover), { status: 200 })
    return new Response(JSON.stringify(state), { status: 200 })
  }

  const loaded = loadBundle()
  loaded.exports.apply(ctx)
  assert.equal(calls.registered.length, 1, 'exactly one row registered')
  const { options, component } = calls.registered[0]
  // The slot host builds the component's props from the registration's
  // `inject()` face — that is where the bound translate and the form come from.
  return { component, props: options.inject(), required: loaded.required }
}

const READY_STATE = {
  platform: 'win32',
  settingsAvailable: true,
  dialect: 'pwsh',
  bashPath: '',
  bashCandidates: [],
  capability: { supported: true },
}

/** Mount a component into a fresh root and return a query helper. */
async function render(Component, props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(Component, props))
  })
  await settle()
  return {
    host,
    text: () => host.textContent ?? '',
    /** A button by its visible label. */
    button: (label) => [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(label)),
    /** The dropdown trigger carrying an accessible name. */
    trigger: (name) => host.querySelector(`button[aria-haspopup="menu"][aria-label="${name}"]`),
    /** Every dropdown trigger in the row. */
    triggers: () => [...host.querySelectorAll('button[aria-haspopup="menu"]')],
    /**
     * The open menu card, if any. The real `Menu` portals it to `document.body`,
     * so it is deliberately *not* looked up inside the row's host.
     */
    menu: () => document.querySelector('[role="menu"]'),
    /** The rows of the open menu. */
    menuItems: () => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')],
    root,
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
}

/** Click one element inside `act`. */
async function click(node) {
  assert.ok(node, 'the element to click exists')
  await act(async () => {
    node.click()
  })
  await settle()
}

// --- tests -----------------------------------------------------------------

await test('the stylesheet is claimed while the module materializes', async () => {
  for (const node of [...document.head.querySelectorAll('style[data-plugin]')]) node.remove()
  loadBundle()
  const sheet = document.head.querySelector('style[data-plugin="dsh-terminal-tool"]')
  assert.ok(sheet, 'a sheet is injected as the module materializes')
  // `data-plugin` is what the loader removes on disable; `data-plugin-css` is
  // this module's own marker for reusing the tag across reloads.
  assert.equal(sheet.getAttribute('data-plugin-css'), 'dsh-terminal-tool/row.css')
  assert.match(sheet.textContent ?? '', /\.tterm-group\{/)
  // A reload reuses the owned tag instead of stacking a second sheet.
  loadBundle()
  assert.equal(document.head.querySelectorAll('style[data-plugin="dsh-terminal-tool"]').length, 1)
})

await test('the row ships the title, one sentence of description and the dialect dropdown', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const text = view.text()
    assert.match(text, /终端工具/)
    assert.match(text, /模型执行命令时使用的终端；改动只影响新会话。/)
    // One control only: the dialect dropdown, showing the current value.
    assert.equal(view.triggers().length, 1, 'exactly one dropdown on the pwsh row')
    assert.match(view.trigger('终端类型').textContent ?? '', /PowerShell（pwsh）/)
    // The path row is bash-only.
    assert.doesNotMatch(text, /自动发现/)
    assert.doesNotMatch(text, /Git Bash 路径/)
    assert.deepEqual(form.mutations, [], 'mounting never writes')
  } finally {
    await view.unmount()
  }
})

await test('the dialect menu lists both kinds and marks the current one', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    assert.equal(view.menu(), null, 'the menu starts closed')
    await click(view.trigger('终端类型'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['PowerShell（pwsh）', 'Git Bash（bash）'],
    )
    // Selected rows are drawn with a leading check icon; the real primitive has
    // no `aria-selected` attribute to assert on.
    assert.deepEqual(
      view.menuItems().map((item) => item.querySelector('[data-check]') !== null),
      [true, false],
    )
    // The card is portaled out of the row, like the real `Menu`.
    assert.equal(view.host.querySelector('[role="menu"]'), null)
  } finally {
    await view.unmount()
  }
})

await test('choosing Git Bash reveals the path row and writes the dialect', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await click(view.trigger('终端类型'))
    await click(view.menuItems()[1])
    assert.match(view.text(), /Git Bash 路径/)
    assert.ok(view.button('自动发现'), 'the Auto-detect button appears with the path row')
    // A missing path explains itself.
    assert.match(view.text(), /点「自动发现」扫描本机/)
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['dialect'], value: 'bash' }]])
    assert.equal(view.menu(), null, 'the menu closes after a choice')
  } finally {
    await view.unmount()
  }
})

await test('the bash row shows the confined-sandbox choice, the pwsh row does not', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const text = view.text()
    assert.match(text, /受限沙箱时/)
    assert.match(
      text,
      /Windows 沙箱会把命令降到低完整性，Git Bash 无法在其中启动；这里决定此时怎么办。/,
    )
    // The default choice is to run directly, and the row says what that costs.
    assert.match(view.trigger('受限沙箱时').textContent ?? '', /直接启动（不经沙箱）/)
    assert.equal(view.host.querySelector('[role="note"]')?.textContent, '注意：选它之后，模型执行的命令不受文件沙箱限制。')
    assert.deepEqual(form.mutations, [], 'mounting never writes')
  } finally {
    await view.unmount()
  }

  // The choice only exists for the bash dialect.
  const pwshForm = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const pwshRow = mountRow({ form: pwshForm, state: READY_STATE, discover: { candidates: [] } })
  const pwshView = await render(pwshRow.component, pwshRow.props)
  try {
    assert.equal(pwshView.trigger('受限沙箱时'), null, 'no confined-sandbox dropdown on the pwsh row')
    assert.doesNotMatch(pwshView.text(), /受限沙箱时/)
    assert.equal(pwshView.host.querySelector('[role="note"]'), null)
  } finally {
    await pwshView.unmount()
  }
})

await test('choosing a confined policy writes it', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await click(view.trigger('受限沙箱时'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['直接启动（不经沙箱）', '受限执行，失败后升级', '报告错误'],
    )
    await click(view.menuItems()[1])
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['confinedPolicy'], value: 'escalate' }]])
    assert.match(view.trigger('受限沙箱时').textContent ?? '', /受限执行，失败后升级/)
    assert.equal(view.menu(), null, 'the menu closes after a choice')
    // Only the unconfined choice carries the warning.
    assert.equal(view.host.querySelector('[role="note"]'), null)
  } finally {
    await view.unmount()
  }
})

await test('the minimal-mode row offers the three choices and writes one', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\Git\bin\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    assert.match(view.text(), /极简模式/)
    assert.match(view.text(), /只影响使用官方「极简模式」预设的会话/)
    assert.equal(view.trigger('极简模式').textContent ?? '', '换成一次性 bash')
    await click(view.trigger('极简模式'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['保持官方持久终端', '换成一次性 bash', '添加 Git Bash 变体'],
    )
    await click(view.menuItems()[2])
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['minimalMode'], value: 'variant' }]])
    assert.match(view.trigger('极简模式').textContent ?? '', /添加 Git Bash 变体/)
  } finally {
    await view.unmount()
  }
})

await test('the minimal-mode row reports the variant lifecycle', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\Git\bin\bash.exe', bashCandidates: [] })

  const ready = mountRow({
    form,
    state: { ...READY_STATE, minimalMode: 'variant', variant: { status: 'registered', id: 'minimal-gitbash', refs: 0 } },
    discover: { candidates: [] },
  })
  const readyView = await render(ready.component, ready.props)
  try {
    assert.match(readyView.text(), /已在预设列表中添加「minimal-gitbash」/)
  } finally {
    await readyView.unmount()
  }

  // A referenced variant is kept rather than removed, and the row says why.
  const retained = mountRow({
    form,
    state: { ...READY_STATE, minimalMode: 'oneshot', variant: { status: 'retained', id: 'minimal-gitbash', refs: 2 } },
    discover: { candidates: [] },
  })
  const retainedView = await render(retained.component, retained.props)
  try {
    assert.match(retainedView.text(), /仍有 2 个会话在使用「minimal-gitbash」/)
    assert.equal(retainedView.host.querySelector('[role="alert"]'), null)
  } finally {
    await retainedView.unmount()
  }

  // A failed registration is an error, not a hint.
  const failed = mountRow({
    form,
    state: {
      ...READY_STATE,
      minimalMode: 'variant',
      variant: { status: 'failed', id: 'minimal-gitbash', refs: 0, reason: 'isolate realms' },
    },
    discover: { candidates: [] },
  })
  const failedView = await render(failed.component, failed.props)
  try {
    assert.match(failedView.text(), /变体注册失败：isolate realms/)
    assert.ok(failedView.host.querySelector('[role="alert"]'), 'a failed variant is an alert')
  } finally {
    await failedView.unmount()
  }
})

await test('a bash row with at most one known path types it into an Input', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('input[aria-label="Git Bash 路径"]')
    assert.ok(input, 'the path is a text field')
    assert.equal(input.value, 'C:\\Git\\bin\\bash.exe')
    assert.equal(view.triggers().length, 3, 'dialect, confined and minimal are menus; the path is an Input')
    assert.doesNotMatch(view.text(), /点「自动发现」扫描本机/)
  } finally {
    await view.unmount()
  }
})

await test('editing the path input and pressing Enter persists it', async () => {
  const form = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('input[aria-label="Git Bash 路径"]')
    // React tracks the previous value on the node; go through the native setter
    // so it sees the change (the standard jsdom/React workaround).
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      setter.call(input, 'C:\\Program Files\\Git\\bin\\bash.exe')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await settle()
    assert.deepEqual(form.mutations, [
      [{ op: 'set', path: ['bashPath'], value: 'C:\\Program Files\\Git\\bin\\bash.exe' }],
    ])
  } finally {
    await view.unmount()
  }
})

await test('Auto-detect scans, then the path control becomes a dropdown of the hits', async () => {
  const form = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [] })
  const row = mountRow({
    form,
    state: READY_STATE,
    discover: {
      candidates: [
        { path: 'C:\\Git\\bin\\bash.exe', source: 'registry', valid: true },
        { path: 'C:\\MSYS2\\usr\\bin\\bash.exe', source: 'msys2', valid: true },
      ],
    },
  })
  const view = await render(row.component, row.props)
  try {
    await click(view.button('自动发现'))
    // Two hits turn the path control into a dropdown; the dialect and confined
    // ones stay.
    assert.equal(view.triggers().length, 4, 'the path control is now a dropdown too')
    const trigger = view.trigger('Git Bash 路径')
    assert.match(trigger.textContent ?? '', /C:\\Git\\bin\\bash\.exe/)
    // The pick and the candidate list are persisted together.
    assert.equal(form.mutations.length, 1)
    assert.deepEqual(form.mutations[0], [
      { op: 'set', path: ['bashPath'], value: 'C:\\Git\\bin\\bash.exe' },
      {
        op: 'set',
        path: ['bashCandidates'],
        value: ['C:\\Git\\bin\\bash.exe', 'C:\\MSYS2\\usr\\bin\\bash.exe'],
      },
    ])

    await click(trigger)
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['C:\\Git\\bin\\bash.exe', 'C:\\MSYS2\\usr\\bin\\bash.exe'],
    )
    await click(view.menuItems()[1])
    assert.deepEqual(form.mutations.at(-1), [
      { op: 'set', path: ['bashPath'], value: 'C:\\MSYS2\\usr\\bin\\bash.exe' },
    ])
  } finally {
    await view.unmount()
  }
})

await test('Auto-detect with no hits explains itself instead of clearing the path', async () => {
  const form = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await click(view.button('自动发现'))
    assert.match(view.text(), /没有找到 Git Bash，请直接填入 bash\.exe 的完整路径。/)
    assert.deepEqual(form.mutations, [])
  } finally {
    await view.unmount()
  }
})

await test('the row is absent off Windows and mounting it wrote nothing', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({
    form,
    state: { ...READY_STATE, platform: 'linux', capability: { supported: false, reason: 'only windows' } },
    discover: { candidates: [] },
  })
  const view = await render(row.component, row.props)
  try {
    // The replacement is Windows-only, so the row renders nothing at all rather
    // than showing a permanently broken control — and it did not touch the
    // configuration on the way.
    assert.equal(view.text(), '', 'the row renders nothing off Windows')
    assert.deepEqual(form.mutations, [])
  } finally {
    await view.unmount()
  }
})

await test('a read-only form locks the dropdown and the Auto-detect button', async () => {
  const form = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [] })
  form.getSnapshot = () => ({
    status: 'ready',
    value: { dialect: 'bash', bashPath: '', bashCandidates: [] },
    revision: 1,
    writable: false,
  })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    assert.equal(view.triggers().length, 3)
    assert.equal(view.trigger('终端类型').disabled, true, 'a non-writable form disables the dropdown')
    assert.equal(view.trigger('受限沙箱时').disabled, true, 'and the confined-policy one')
    assert.equal(view.button('自动发现').disabled, true, 'and the Auto-detect button')
    assert.equal(view.host.querySelector('input[aria-label="Git Bash 路径"]').disabled, true)
  } finally {
    await view.unmount()
  }
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
