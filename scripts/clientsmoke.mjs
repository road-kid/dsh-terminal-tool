/**
 * Client bundle smoke test.
 *
 * The client half is a classic script served straight into the page, so nothing
 * in the normal toolchain ever *executes* it — `tsc` only type-checks the
 * sources and `esbuild` only bundles them. This script closes that gap: it loads
 * `lib/client.js` the way the page does (`window.__ModuleLoader__.load`), then
 * drives `apply()` with a stub cordis context and asserts the row registers into
 * `settings.general.item` with a working form handle.
 *
 * It is deliberately dependency-free (no jsdom): the row component itself is
 * exercised through its controller, which is where all the logic lives.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')

let passed = 0
const failures = []

async function test(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`ok   ${name}\n`)
  } catch (error) {
    failures.push({ name, error })
    process.stdout.write(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

/** Load the bundle exactly like the page's module loader does. */
function loadBundle() {
  const registered = []
  const window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        registered.push({ id, factory })
      },
    },
  }
  // eslint-disable-next-line no-new-func -- the bundle is a classic script.
  new Function('window', 'document', 'fetch', source)(window, undefined, undefined)
  assert.equal(registered.length, 1, 'the bundle registers exactly one module')
  const [{ id, factory }] = registered
  const required = []
  const exports = factory((specifier) => {
    required.push(specifier)
    if (specifier === 'react' || specifier === 'react/jsx-runtime') return {}
    throw new Error(`unexpected require(${specifier})`)
  })
  return { id, exports, required }
}

await test('bundle registers itself under the package name', () => {
  const { id } = loadBundle()
  assert.equal(id, 'dsh-terminal-tool')
})

await test('bundle keeps react external', () => {
  const { required } = loadBundle()
  assert.deepEqual([...new Set(required)].sort(), ['react', 'react/jsx-runtime'])
})

await test('exports the entry shape the loader calls', () => {
  const { exports } = loadBundle()
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
  assert.equal(exports.GENERAL_ITEM_ID, 'terminal-tool')
  assert.equal(exports.GENERAL_ITEM_ORDER, 60)
})

/** A stub context recording what `apply` does. */
function stubContext({ withForms = true } = {}) {
  const calls = { locale: [], injected: [], registered: [], effects: [] }
  const form = {
    getSnapshot: () => ({
      status: 'ready',
      value: { dialect: 'pwsh', bashPath: '', bashCandidates: [] },
      revision: 1,
      writable: true,
    }),
    subscribe: () => () => {},
    mutate: async () => true,
  }
  const slots = {
    inject(name, callback) {
      calls.injected.push(name)
      return callback()
    },
    register(registration, component) {
      calls.registered.push({ registration, component })
      return () => {}
    },
  }
  const locale = {
    register(namespace, dictionaries) {
      calls.locale.push({ namespace, dictionaries })
      return () => {}
    },
    bind: (namespace) => (key, params) => `${namespace}:${key}${params === undefined ? '' : JSON.stringify(params)}`,
  }
  const configForms = {
    get: () => form,
    whileServed: (namespaces, register) => register(new Set(namespaces)),
  }
  const ctx = {
    effect(callback, label) {
      calls.effects.push(label)
      return callback()
    },
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      if (name === 'configForms') return withForms ? configForms : undefined
      return undefined
    },
    inject(names, callback) {
      calls.injected.push(...names.map((name) => `defer:${name}`))
      callback(ctx)
    },
  }
  return { ctx, calls, form }
}

await test('apply registers the row into settings.general.item', () => {
  const { ctx, calls } = stubContext()
  loadBundle().exports.apply(ctx)
  assert.deepEqual(calls.locale.map((entry) => entry.namespace), ['terminal-tool'])
  assert.ok(calls.locale[0].dictionaries.zh['row.title'] !== undefined, 'zh dictionary ships')
  assert.ok(calls.locale[0].dictionaries.en['row.title'] !== undefined, 'en dictionary ships')
  assert.deepEqual(calls.injected, ['settings.general.item'])
  assert.equal(calls.registered.length, 1)
  const { registration, component } = calls.registered[0]
  assert.equal(registration.name, 'settings.general.item')
  assert.equal(registration.id, 'terminal-tool')
  assert.equal(registration.order, 60)
  assert.equal(registration.locale, 'terminal-tool')
  assert.equal(typeof component, 'function', 'the slot gets the row component')
})

await test('the slot face carries a bound translate and the form', () => {
  const { ctx, calls, form } = stubContext()
  loadBundle().exports.apply(ctx)
  const face = calls.registered[0].registration.inject()
  assert.equal(face.form, form)
  assert.equal(face.t('row.title'), 'terminal-tool:row.title')
})

await test('a Host without configForms still seats a read-only row', () => {
  const { ctx, calls } = stubContext({ withForms: false })
  loadBundle().exports.apply(ctx)
  assert.equal(calls.registered.length, 1, 'the row is still registered')
  assert.equal(calls.registered[0].registration.inject().form, undefined)
})

await test('a late configForms replaces the read-only row instead of stacking', () => {
  // The stub's ctx.inject runs the callback immediately, which is exactly the
  // late-service path: the first apply seats a row with no form, the deferred
  // injection seats one with it. Only one row may survive.
  const { ctx, calls, form } = stubContext({ withForms: false })
  let disposed = 0
  // `configForms` only becomes visible after the first apply has run, which is
  // what the deferred `ctx.inject` path exists for.
  let formsReady = false
  const registered = calls.registered
  ctx.get = (name) => {
    if (name === 'slots') {
      return {
        inject: (slot, callback) => callback(),
        register(registration, component) {
          registered.push({ registration, component })
          return () => {
            disposed += 1
          }
        },
      }
    }
    if (name === 'locale') return undefined
    if (name === 'configForms') return formsReady ? { get: () => form } : undefined
    return undefined
  }
  ctx.effect = (callback) => {
    callback()
    formsReady = true
  }
  loadBundle().exports.apply(ctx)
  assert.equal(registered.length, 2, 'the read-only row is replaced by a writable one')
  assert.equal(disposed, 1, 'the read-only row is disposed first')
  assert.equal(registered[1].registration.inject().form, form)
})

await test('apply is idempotent across a re-run (HMR)', () => {
  const { ctx, calls } = stubContext()
  const { exports } = loadBundle()
  exports.apply(ctx)
  exports.apply(ctx)
  assert.equal(calls.registered.length, 1, 'the row is not registered twice')
})

process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`)
if (failures.length > 0) process.exitCode = 1
