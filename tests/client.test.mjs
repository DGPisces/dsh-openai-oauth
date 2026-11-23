import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const React = require('react')
const TestRenderer = require('react-test-renderer')
const { act } = TestRenderer
const source = readFileSync(new URL('../src/client.tsx', import.meta.url), 'utf8')

// Transpile in memory: these tests exercise the current source without generating lib/.
function loadClient(language = 'en') {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    fileName: 'client.tsx',
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'navigator', compiled)(require, module, module.exports, { language })
  return module.exports
}

// Execute the installed/lib artifact through the same module-loader contract
// DSH uses, so a broken client bundle cannot hide behind source-only tests.
function loadBuiltClient(language = 'en', window = {}) {
  const built = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory
  window.__ModuleLoader__ = { load(options) { factory = options.factory } }
  new Function('window', 'navigator', built)(window, { language })
  assert.equal(typeof factory, 'function')
  return factory(name => name === 'react' ? React : name === 'react/jsx-runtime' ? require('react/jsx-runtime') : require(name))
}

function eventSource() {
  const listeners = new Map()
  return {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener) },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    emit(type) { for (const listener of listeners.get(type) ?? []) listener() },
    count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
  }
}
function fakeBrowser() {
  const win = eventSource(), doc = eventSource()
  let next = 0
  const intervals = new Map(), timeouts = new Map()
  Object.assign(win, {
    setInterval: fn => { intervals.set(++next, fn); return next },
    clearInterval: id => intervals.delete(id),
    setTimeout: fn => { timeouts.set(++next, fn); return next },
    clearTimeout: id => timeouts.delete(id),
  })
  doc.visibilityState = 'visible'
  return { win, doc, intervals, timeouts }
}
function defer() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const pending = (clientId, subject) => ({ authenticated: true, welcomePending: true, activeClientId: clientId, activeSubject: subject })

function installGlobals(values) {
  const descriptors = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  return () => { for (const [key, descriptor] of Object.entries(descriptors)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key] }
}

test('accepts only the exact one-time loopback authorization ticket', () => {
  const { isAuthorizationUrl } = loadClient()
  const ticket = 'a'.repeat(43)
  assert.equal(isAuthorizationUrl(`http://127.0.0.1:32123/auth/start/${ticket}`), true)
  for (const value of [undefined, '', 'javascript:alert(1)', 'https://auth.openai.com/',
    `http://localhost:32123/auth/start/${ticket}`, `http://127.0.0.1:0/auth/start/${ticket}`,
    `http://127.0.0.1:65536/auth/start/${ticket}`, `http://127.0.0.1:32123/auth/start/${ticket}?x=1`,
    `http://127.0.0.1:32123/auth/start/${ticket}#x`, `http://user@127.0.0.1:32123/auth/start/${ticket}`,
    `http://127.0.0.1:32123/auth/start/${ticket.slice(1)}`, `http://127.0.0.1:32123/auth%2fstart/${ticket}`]) {
    assert.equal(isAuthorizationUrl(value), false, String(value))
  }
})

test('the installed client bundle loads through the module loader and exposes the login surface', async () => {
  const browser = fakeBrowser()
  const plugin = loadBuiltClient('en', browser.win)
  assert.deepEqual(plugin.inject, ['slots'])
  for (const name of ['OpenAiOAuthSection', 'OpenAiOnboarding', 'WelcomeHost', 'apply']) assert.equal(typeof plugin[name], 'function')
  const restore = installGlobals({ window: browser.win, document: browser.doc, fetch: async url => {
    if (url.endsWith('/status?light=1')) return json({ authenticated: true, planUsage: 'enabled', login: { state: 'idle' } })
    if (url.endsWith('/accounts')) return json({ accounts: [] })
    throw new Error(`Unexpected request: ${url}`)
  } })
  let tree
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(plugin.OpenAiOAuthSection)); await flush() })
    const text = JSON.stringify(tree.toJSON())
    assert.match(text, /OpenAI OAuth/)
    assert.match(text, /Signed in/)
    await act(async () => { tree.unmount() })
  } finally { if (tree) tree.unmount(); restore() }
})

test('model responses require valid unique IDs and names before saving', () => {
  const { parseModels } = loadClient()
  assert.deepEqual(parseModels({ models: [{ id: 'a', name: 'Alpha', extra: 'ignored' }] }), [{ id: 'a', name: 'Alpha' }])
  assert.deepEqual(parseModels({ models: [] }), [])
  for (const bad of [null, {}, { models: null }, { models: [{}] }, { models: [{ id: '', name: 'A' }] },
    { models: [{ id: 'a', name: '' }] }, { models: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }]) {
    assert.equal(parseModels(bad), undefined)
  }
})

test('registers settings, onboarding, and the independent root overlay with effect cleanup', () => {
  const plugin = loadClient()
  assert.deepEqual(plugin.inject, ['slots'])
  const registrations = [], effects = [], disposed = []
  const ctx = {
    effect(fn, id) { effects.push({ id, dispose: fn() }) },
    slots: {
      inject(key, callback) { const dispose = callback(); return () => { disposed.push(key); dispose() } },
      register(options, component) { registrations.push({ options, component }); return () => {} },
    },
  }
  plugin.apply(ctx)
  assert.deepEqual(registrations.map(({ options }) => [options.name, options.id, options.order]), [
    ['settings.section', 'openai-oauth', 11], ['settings.onboarding', 'openai-oauth', 100], ['shell.overlay', 'openai-oauth-welcome', 100],
  ])
  assert.equal(registrations[0].options.label(), 'OpenAI OAuth')
  assert.equal(registrations[1].component, plugin.OpenAiOnboarding)
  assert.equal(registrations[2].component, plugin.WelcomeHost)
  assert.ok(registrations.every(({ component }) => typeof component === 'function'))
  for (const effect of effects) effect.dispose()
  assert.deepEqual(disposed, ['settings.section', 'settings.onboarding', 'shell.overlay'])
  for (const token of ['--dsw-alias-button-elevated-fill', '--dsw-alias-label-primary', '--dsw-alias-button-primary-fill', '--dsw-alias-label-primary-foreground']) {
    assert.ok(source.includes(`var(${token})`), `missing theme token ${token}`)
  }
  assert.ok(source.includes('https://chatgpt.com/settings/usage'))
  assert.ok(source.includes('data-oai-siwc-button'))
})

test('first-run onboarding discloses data use before login and remembers only an anonymous completion flag', async () => {
  const { OpenAiOnboarding } = loadClient()
  const browser = fakeBrowser(), seen = new Map(), requests = [], opened = []
  const popup = { opener: {}, location: {}, close() { assert.fail('login should navigate the popup') } }
  Object.assign(browser.win, { open: () => popup, localStorage: { getItem: id => seen.get(id), setItem: (id, value) => seen.set(id, value) } })
  const ticket = `http://127.0.0.1:12345/auth/start/${'z'.repeat(43)}`
  const restore = installGlobals({ window: browser.win, fetch: async (url, init) => {
    requests.push(url)
    if (url.endsWith('/status?light=1')) return json({ authenticated: false })
    if (url.endsWith('/accounts')) return json({ accounts: [] })
    assert.ok(url.endsWith('/login'))
    assert.deepEqual(JSON.parse(init.body), { newAccount: true })
    return json({ authUrl: ticket })
  } })
  let completed = 0, tree
  const props = { stepId: 'openai-oauth', complete: () => completed++, openSection: section => opened.push(section) }
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(OpenAiOnboarding, props)); await flush() })
    const content = JSON.stringify(tree.toJSON())
    assert.match(content, /credentials locally/)
    assert.match(content, /official OpenAI Responses API for inference/)
    assert.match(content, /keeps its local registration/)
    assert.match(content, /solely to retry revocation/)
    assert.deepEqual(tree.root.findAllByType('a').map(link => link.props.href), [
      'https://github.com/DGPisces/dsh-openai-oauth#privacy-and-data-handling',
      'https://openai.com/policies/privacy-policy/',
      'https://openai.com/policies/sign-in-with-chatgpt-terms/',
    ])
    assert.equal(requests.length, 2)
    const signIn = tree.root.findAllByType('button').find(button => button.props['data-oai-siwc-button'] !== undefined)
    assert.ok(signIn)
    await act(async () => { signIn.props.onClick(); await flush() })
    assert.equal(popup.opener, null)
    assert.equal(popup.location.href, ticket)
    assert.equal(completed, 1)
    assert.deepEqual(opened, ['openai-oauth'])
    assert.deepEqual([...seen.entries()], [['dsh.openai-oauth.onboarding-seen', '1']])
    await act(async () => { tree.unmount() })
    await act(async () => { tree = TestRenderer.create(React.createElement(OpenAiOnboarding, props)); await flush() })
    assert.equal(tree.toJSON(), null)
    assert.equal(completed, 2)
    assert.equal(requests.length, 3)
    await act(async () => { tree.unmount() })
  } finally { tree?.unmount(); restore() }
})

test('welcome requires a pending signed-in identity from the same status snapshot', () => {
  const { welcomeIdentity } = loadClient()
  assert.deepEqual(welcomeIdentity(pending('client-a', 'subject-a')), { clientId: 'client-a', subject: 'subject-a' })
  for (const status of [null, {}, { ...pending('a', 's'), authenticated: false },
    { ...pending('a', 's'), welcomePending: false }, pending('', 's'), pending('a', ''), pending('a', null)]) {
    assert.equal(welcomeIdentity(status), undefined)
  }
})

test('global welcome monitor polls once, refreshes on focus, ignores stale results, and cleans up', async () => {
  const { watchWelcome } = loadClient()
  const browser = fakeBrowser(), requests = [], changes = []
  const restore = installGlobals({ window: browser.win, document: browser.doc, fetch: (url, options) => {
    const reply = defer(); requests.push({ url, options, ...reply }); return reply.promise
  } })
  try {
    const monitor = watchWelcome(value => changes.push(value))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/api/openai-oauth/status?light=1')
    assert.equal(requests[0].options.credentials, 'same-origin')
    assert.equal(requests[0].options.cache, 'no-store')
    assert.equal(browser.intervals.size, 1)
    assert.equal(browser.timeouts.size, 1)
    browser.win.emit('focus')
    for (const tick of browser.intervals.values()) tick()
    assert.equal(requests.length, 1, 'no duplicate in-flight polls')

    monitor.refresh()
    assert.equal(requests[0].options.signal.aborted, true)
    assert.equal(requests.length, 2)
    requests[1].resolve(json(pending('b', 'subject-b')))
    await flush()
    assert.deepEqual(changes, [{ clientId: 'b', subject: 'subject-b' }])
    requests[0].resolve(json(pending('a', 'subject-a')))
    await flush()
    assert.deepEqual(changes, [{ clientId: 'b', subject: 'subject-b' }], 'late response must not replace newer identity')

    browser.doc.visibilityState = 'hidden'; browser.doc.emit('visibilitychange')
    assert.equal(requests.length, 2)
    browser.doc.visibilityState = 'visible'; browser.doc.emit('visibilitychange')
    assert.equal(requests.length, 3)
    requests[2].resolve(json({ error: 'unavailable' }, 503))
    await flush()
    assert.equal(changes.length, 1, 'failure does not dismiss an existing notice')
    browser.win.emit('focus')
    assert.equal(requests.length, 4)
    requests[3].resolve(json({ authenticated: true, welcomePending: false }))
    await flush()
    assert.equal(changes.at(-1), undefined)

    browser.win.emit('focus')
    assert.equal(requests.length, 5)
    monitor.dispose(); monitor.dispose()
    assert.equal(requests[4].options.signal.aborted, true)
    assert.equal(browser.intervals.size, 0)
    assert.equal(browser.timeouts.size, 0)
    assert.equal(browser.win.count(), 0)
    assert.equal(browser.doc.count(), 0)
    requests[4].resolve(json(pending('c', 'subject-c')))
    await flush()
    assert.equal(changes.at(-1), undefined, 'no updates after disposal')
    monitor.refresh(); assert.equal(requests.length, 5)
  } finally { restore() }
})

test('welcome acknowledgement sends the displayed client and subject and rejects changed accounts', async () => {
  const { acknowledgeWelcome } = loadClient()
  const calls = []
  const restore = installGlobals({ fetch: async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? json({ ok: true }) : json({ code: 'ACCOUNT_CHANGED' }, 409)
  } })
  try {
    const shown = { clientId: 'client-a', subject: 'subject-a' }
    await acknowledgeWelcome(shown)
    assert.equal(calls[0].url, '/api/openai-oauth/welcome/ack')
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(calls[0].options.body), shown)
    await assert.rejects(acknowledgeWelcome(shown), error => error.code === 'ACCOUNT_CHANGED')
  } finally { restore() }
})

test('logout text distinguishes no session, unconfirmed and confirmed revocation in both languages', () => {
  const en = loadClient('en-US'), zh = loadClient('zh-CN')
  for (const client of [en, zh]) {
    assert.equal(client.logoutOutcome('not_applicable').unconfirmed, false)
    assert.equal(client.logoutOutcome('confirmed').unconfirmed, false)
    assert.equal(client.logoutOutcome('unconfirmed').unconfirmed, true)
    assert.equal(client.logoutOutcome(undefined).unconfirmed, true)
    assert.notEqual(client.logoutOutcome('not_applicable').message, client.logoutOutcome('unconfirmed').message)
    assert.notEqual(client.logoutOutcome('not_applicable').message, client.logoutOutcome('confirmed').message)
  }
  assert.match(en.logoutOutcome('not_applicable').message, /no known session.*no remote revocation/i)
  assert.match(zh.logoutOutcome('not_applicable').message, /没有已知.*未进行远端撤销/)
  assert.match(en.logoutOutcome('unconfirmed').message, /could not be confirmed/)
  assert.match(zh.logoutOutcome('unconfirmed').message, /无法确认/)
})

test('WelcomeHost prevents duplicate clicks and never acknowledges a newly switched account', async () => {
  const { WelcomeHost } = loadClient()
  const browser = fakeBrowser(), acknowledgements = [], dialogs = []
  let status = pending('client-a', 'subject-a')
  const restore = installGlobals({ window: browser.win, document: browser.doc, fetch: (url, options) => {
    if (url.endsWith('/status?light=1')) return Promise.resolve(json(status))
    if (url.endsWith('/welcome/ack')) {
      const response = defer(); acknowledgements.push({ body: JSON.parse(options.body), ...response }); return response.promise
    }
    throw new Error(`Unexpected request: ${url}`)
  } })
  let tree
  try {
    await act(async () => {
      tree = TestRenderer.create(React.createElement(WelcomeHost), { createNodeMock: element => {
        if (element.type !== 'dialog') return null
        const dialog = { opened: 0, closed: 0, showModal() { this.opened++ }, close() { this.closed++ } }
        dialogs.push(dialog); return dialog
      } })
      await flush()
    })
    assert.equal(tree.root.findAllByType('dialog').length, 1)
    assert.equal(dialogs[0].opened, 1)
    let prevented = false
    tree.root.findByType('dialog').props.onCancel({ preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(acknowledgements.length, 0, 'Escape does not acknowledge')
    const click = () => tree.root.findByType('button').props.onClick()
    await act(async () => { click(); click(); await flush() })
    assert.equal(acknowledgements.length, 1)
    assert.deepEqual(acknowledgements[0].body, { clientId: 'client-a', subject: 'subject-a' })
    assert.equal(tree.root.findByType('button').props.disabled, true)

    status = pending('client-b', 'subject-b')
    await act(async () => { browser.win.emit('focus'); await flush() })
    assert.equal(dialogs[0].closed, 1)
    assert.equal(tree.root.findAllByType('dialog').length, 1)
    await act(async () => { acknowledgements[0].resolve(json({ code: 'ACCOUNT_CHANGED' }, 409)); await flush() })
    assert.equal(tree.root.findAllByType('dialog').length, 1, 'old account failure cannot close new account notice')
    await act(async () => { click(); await flush() })
    assert.equal(acknowledgements.length, 2)
    assert.deepEqual(acknowledgements[1].body, { clientId: 'client-b', subject: 'subject-b' })
    status = { authenticated: true, welcomePending: false, activeClientId: 'client-b', activeSubject: 'subject-b' }
    await act(async () => { acknowledgements[1].resolve(json({ ok: true })); await flush() })
    assert.equal(tree.root.findAllByType('dialog').length, 0)
    await act(async () => { tree.unmount() })
    assert.equal(browser.intervals.size, 0)
    assert.equal(browser.timeouts.size, 0)
    assert.equal(browser.win.count(), 0)
    assert.equal(browser.doc.count(), 0)
  } finally { if (tree) tree.unmount(); restore() }
})

test('sign-out UI displays the actual revocation outcome in English and Chinese', async () => {
  for (const language of ['en-US', 'zh-CN']) {
    for (const revocation of ['confirmed', 'unconfirmed', 'not_applicable']) {
      const client = loadClient(language), browser = fakeBrowser()
      let status = { ...pending('client-a', 'subject-a'), planUsage: 'disabled' }
      let logoutCalls = 0
      const restore = installGlobals({ window: browser.win, document: browser.doc, fetch: (url) => {
        if (url.endsWith('/status?light=1')) return Promise.resolve(json(status))
        if (url.endsWith('/accounts')) return Promise.resolve(json({ accounts: [] }))
        if (url.endsWith('/logout')) {
          logoutCalls++
          status = { authenticated: false, welcomePending: false }
          return Promise.resolve(json({ ok: true, revocation }))
        }
        throw new Error(`Unexpected request: ${url}`)
      } })
      let tree
      try {
        await act(async () => { tree = TestRenderer.create(React.createElement(client.OpenAiOAuthSection, {})); await flush() })
        const signOut = tree.root.findAllByType('button').find(node => node.children.includes(language === 'zh-CN' ? '退出当前账户' : 'Sign out of active account'))
        assert.ok(signOut)
        await act(async () => { signOut.props.onClick(); await flush() })
        assert.equal(logoutCalls, 1)
        const rendered = JSON.stringify(tree.toJSON())
        assert.ok(rendered.includes(client.logoutOutcome(revocation).message))
        if (revocation === 'not_applicable') {
          assert.ok(!rendered.includes(client.logoutOutcome('unconfirmed').message))
          assert.ok(!rendered.includes(client.logoutOutcome('confirmed').message))
        }
        await act(async () => { tree.unmount() })
      } finally { if (tree) tree.unmount(); restore() }
    }
  }
})

test('settings can retry unfinished revocation without signing out the active account', async () => {
  const client = loadClient(), browser = fakeBrowser(), actions = []
  let status = { ...pending('client-a', 'subject-a'), planUsage: 'disabled', pendingRevocation: true, login: { state: 'failed', code: 'invalid_client' } }
  const restore = installGlobals({ window: browser.win, document: browser.doc, fetch: async (url, init) => {
    if (url.endsWith('/status?light=1')) return json(status)
    if (url.endsWith('/accounts')) return json({ accounts: [] })
    assert.ok(url.endsWith('/logout'))
    actions.push(JSON.parse(init.body))
    status = { ...status, pendingRevocation: false, login: { state: 'idle' } }
    return json({ ok: true, revocation: 'confirmed' })
  } })
  let tree
  try {
    await act(async () => { tree = TestRenderer.create(React.createElement(client.OpenAiOAuthSection, {})); await flush() })
    assert.match(JSON.stringify(tree.toJSON()), /OpenAI rejected this app registration/)
    const retry = tree.root.findAllByType('button').find(button => button.children.includes('Resolve unfinished remote revocation'))
    assert.ok(retry)
    await act(async () => { retry.props.onClick(); await flush() })
    assert.deepEqual(actions, [{ pendingOnly: true }])
    const content = JSON.stringify(tree.toJSON())
    assert.match(content, /The pending remote sessions were revoked/)
    assert.match(content, /Sign out of active account/)
    await act(async () => { tree.unmount() })
  } finally { tree?.unmount(); restore() }
})
