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
    /** The open menu card, if any. */
    menu: () => host.querySelector('[role="menu"]'),
    /** The rows of the open menu. */
    menuItems: () => [...host.querySelectorAll('[role="menu"] [role="menuitem"]')],
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
    assert.deepEqual(
      view.menuItems().map((item) => item.getAttribute('aria-selected')),
      ['true', 'false'],
    )
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

await test('a bash row with at most one known path types it into an Input', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('input[aria-label="Git Bash 路径"]')
    assert.ok(input, 'the path is a text field')
    assert.equal(input.value, 'C:\\Git\\bin\\bash.exe')
    assert.equal(view.triggers().length, 1, 'only the dialect dropdown is a menu')
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
    // Two hits turn the path control into a dropdown; the dialect one stays.
    assert.equal(view.triggers().length, 2, 'the path control is now a dropdown too')
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
    assert.equal(view.triggers().length, 1)
    assert.equal(view.trigger('终端类型').disabled, true, 'a non-writable form disables the dropdown')
    assert.equal(view.button('自动发现').disabled, true, 'and the Auto-detect button')
    assert.equal(view.host.querySelector('input[aria-label="Git Bash 路径"]').disabled, true)
  } finally {
    await view.unmount()
  }
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
