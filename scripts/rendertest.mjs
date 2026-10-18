/**
 * Render test: mount the real client bundle in a DOM and drive the row.
 *
 * `rowselftest.mjs` covers the controller's decisions and `clientsmoke.mjs`
 * covers the registration contract, but neither renders JSX. This script loads
 * `lib/client.js` exactly as the page does (`window.__ModuleLoader__.load`),
 * calls `apply()` on a stub context, then mounts the registered component with
 * React 18 in jsdom and clicks through it.
 *
 * It catches the class of bug the other two cannot: a hook order error, a
 * missing `useEffect`, a control that never appears, an `onChange` wired to the
 * wrong handler.
 *
 * Run with `npm run rendertest`. Needs `react`, `react-dom` and `jsdom`, which
 * are devDependencies only: the shipped bundle keeps react external.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)

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
  // The bundle is a classic script: run it with `window` bound to our stub and a
  // `require` that resolves react from node_modules (the page seeds the same two
  // modules).
  new Function('window', 'require', source)(windowStub, require)
  assert.ok(captured, 'the bundle called __ModuleLoader__.load')
  return { id: captured.id, exports: captured.factory(require) }
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

  loadBundle().exports.apply(ctx)
  assert.equal(calls.registered.length, 1, 'exactly one row registered')
  const { options, component } = calls.registered[0]
  // The slot host builds the component's props from the registration's
  // `inject()` face — that is where the bound translate and the form come from.
  return { component, props: options.inject() }
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
    button: (label) => [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(label)),
    root,
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
}

// --- tests -----------------------------------------------------------------

await test('the row renders the title, both chips and the footer note', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const text = view.text()
    assert.match(text, /终端工具/)
    assert.match(text, /PowerShell（pwsh）/)
    assert.match(text, /Git Bash（bash）/)
    assert.match(text, /更改对新会话生效/)
    // The path row is bash-only.
    assert.doesNotMatch(text, /自动发现/)
    assert.doesNotMatch(text, /Git Bash 路径/)
  } finally {
    await view.unmount()
  }
})

await test('the pwsh chip starts selected and bash is not', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const chips = [...view.host.querySelectorAll('.tterm-chip')]
    assert.equal(chips.length, 2)
    assert.equal(chips[0].getAttribute('aria-pressed'), 'true')
    assert.equal(chips[1].getAttribute('aria-pressed'), 'false')
    assert.ok(chips[0].className.includes('tterm-chip-on'))
  } finally {
    await view.unmount()
  }
})

await test('clicking the bash chip reveals the path row and writes dialect', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const bash = view.button('Git Bash（bash）')
    assert.ok(bash, 'bash chip exists')
    await act(async () => {
      bash.click()
    })
    await settle()
    assert.match(view.text(), /Git Bash 路径/)
    assert.ok(view.button('自动发现'), 'the Auto-detect button appears with the path row')
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['dialect'], value: 'bash' }]])
    // A missing path explains itself.
    assert.match(view.text(), /还没选 Git Bash 路径/)
  } finally {
    await view.unmount()
  }
})

await test('a bash row with one path shows a text input, not a select', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('.tterm-input')
    assert.equal(input.tagName, 'INPUT')
    assert.equal(input.value, 'C:\\Git\\bin\\bash.exe')
    assert.doesNotMatch(view.text(), /还没选 Git Bash 路径/)
  } finally {
    await view.unmount()
  }
})

await test('editing the path input and pressing Enter persists it', async () => {
  const form = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('.tterm-input')
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

await test('Auto-detect scans, then the control becomes a select of the hits', async () => {
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
    const button = view.button('自动发现')
    assert.ok(button, 'Auto-detect is present')
    await act(async () => {
      button.click()
    })
    await settle()
    const select = view.host.querySelector('select.tterm-input')
    assert.ok(select, 'two hits turn the path control into a select')
    assert.deepEqual(
      [...select.querySelectorAll('option')].map((option) => option.value),
      ['C:\\Git\\bin\\bash.exe', 'C:\\MSYS2\\usr\\bin\\bash.exe'],
    )
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
  } finally {
    await view.unmount()
  }
})

await test('Auto-detect with no hits explains itself instead of clearing the path', async () => {
  const form = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await act(async () => {
      view.button('自动发现').click()
    })
    await settle()
    assert.match(view.text(), /没有找到任何 Git Bash/)
    assert.deepEqual(form.mutations, [])
  } finally {
    await view.unmount()
  }
})

await test('mounting never writes, and the row is absent off Windows', async () => {
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

await test('a read-only form disables the controls', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  form.getSnapshot = () => ({ status: 'ready', value: { dialect: 'pwsh', bashPath: '', bashCandidates: [] }, revision: 1, writable: false })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    for (const chip of view.host.querySelectorAll('.tterm-chip')) {
      assert.equal(chip.disabled, true, 'a non-writable form disables the chips')
    }
  } finally {
    await view.unmount()
  }
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
