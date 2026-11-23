import assert from 'node:assert/strict'
import test from 'node:test'
import { API_REF, AuthModeController, PLAN_REF } from '../lib/auth-mode.js'
import { configEditorStore } from '../lib/route-config.js'
import { SiwcServiceError } from '../lib/siwc-service.js'

/** A credential plane that answers only what the controller asks. */
function fakeCredentials(configured = true) {
  return {
    async describe() { return { configured, writable: true } },
  }
}

/** The sign-in service surface the controller reads. */
function fakeService(signedIn = true) {
  return { async getIdentity() { return signedIn ? { clientId: 'client-a', subject: 'subject-a' } : undefined } }
}

/** A route store whose reference the test can inspect. */
function fakeStore(initial = PLAN_REF) {
  let ref = initial
  return {
    writes: [],
    current: () => ref,
    async currentApiKeyEnv() { return ref },
    async setApiKeyEnv(next) { this.writes.push(next); ref = next },
  }
}

test('state maps the route reference to a mode and reports what is available', async () => {
  const store = fakeStore(PLAN_REF)
  const controller = new AuthModeController({ store, credentials: fakeCredentials(true), service: fakeService(true) })
  assert.deepEqual(await controller.state(), { mode: 'plan', apiKeyAvailable: true, signedIn: true, canSwitch: true })
  await store.setApiKeyEnv(API_REF)
  assert.deepEqual(await controller.state(), { mode: 'api', apiKeyAvailable: true, signedIn: true, canSwitch: true })
  await store.setApiKeyEnv('SOMETHING_ELSE')
  assert.equal((await controller.state()).mode, 'other')
})

test('without a route or an editor the switch is unavailable', async () => {
  const noEditor = new AuthModeController({ credentials: fakeCredentials(false), service: fakeService(false) })
  assert.deepEqual(await noEditor.state(), { mode: 'missing', apiKeyAvailable: false, signedIn: false, canSwitch: false })
  await assert.rejects(() => noEditor.switch('plan'), error => error.code === 'NO_CONFIG_EDITOR' && error.status === 409)

  const noRoute = new AuthModeController({
    store: { async currentApiKeyEnv() { return undefined }, async setApiKeyEnv() {} },
    credentials: fakeCredentials(true), service: fakeService(true),
  })
  assert.equal((await noRoute.state()).mode, 'missing')
  await assert.rejects(() => noRoute.switch('plan'), error => error.code === 'NO_OPENAI_ROUTE' && error.status === 409)
})

test('switching writes the reference that selects the requested authentication', async () => {
  const store = fakeStore(PLAN_REF)
  const controller = new AuthModeController({ store, credentials: fakeCredentials(true), service: fakeService(true) })
  assert.deepEqual(await controller.switch('api'), { mode: 'api', apiKeyAvailable: true, signedIn: true, canSwitch: true })
  assert.deepEqual(store.writes, [API_REF])
  assert.deepEqual(await controller.switch('plan'), { mode: 'plan', apiKeyAvailable: true, signedIn: true, canSwitch: true })
  assert.deepEqual(store.writes, [API_REF, PLAN_REF])
})

test('API mode is refused while no API key is stored', async () => {
  const store = fakeStore(PLAN_REF)
  const controller = new AuthModeController({ store, credentials: fakeCredentials(false), service: fakeService(true) })
  await assert.rejects(() => controller.switch('api'), error => error.code === 'API_KEY_MISSING' && error.status === 409)
  assert.deepEqual(store.writes, [])
})

test('an unknown mode is rejected before any write', async () => {
  const store = fakeStore(PLAN_REF)
  const controller = new AuthModeController({ store, credentials: fakeCredentials(true), service: fakeService(true) })
  await assert.rejects(() => controller.switch('browser'), error => error.code === 'INVALID_MODE' && error.status === 400)
  assert.deepEqual(store.writes, [])
})

test('plan mode may be selected while signed out, so the user can sign in afterwards', async () => {
  const store = fakeStore(API_REF)
  const controller = new AuthModeController({ store, credentials: fakeCredentials(true), service: fakeService(false) })
  const state = await controller.switch('plan')
  assert.equal(state.mode, 'plan')
  assert.equal(state.signedIn, false)
})

/** A profile editor over one in-memory configuration row. */
function fakeEditor(initial) {
  const entry = { options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' } }
  const row = { entry, inherited: {}, override: initial }
  return {
    entry,
    rows: [row],
    edits: [],
    entries() { return [entry] },
    configuration() { return [row] },
    async edit(target, change) {
      if (target !== entry) throw new Error('unknown entry')
      const next = change(structuredClone(row.override), row.inherited)
      this.edits.push(next)
      row.override = next
    },
  }
}

const providerConfig = () => ({
  providers: {
    kimi: { apiKeyEnv: 'KIMI_CODING_API_KEY', models: [{ id: 'k3.1-pro' }] },
    openai: {
      apiKeyEnv: PLAN_REF,
      models: [{ id: 'gpt-6.2-sol', contextWindow: 500000 }],
    },
  },
})

test('the configuration store reads the route reference from the explicit layer', async () => {
  const editor = fakeEditor(providerConfig())
  const store = configEditorStore(editor)
  assert.equal(await store.currentApiKeyEnv(), PLAN_REF)
})

test('the configuration store replaces only the route reference', async () => {
  const editor = fakeEditor(providerConfig())
  const store = configEditorStore(editor)
  await store.setApiKeyEnv(API_REF)
  assert.equal(await store.currentApiKeyEnv(), API_REF)
  const written = editor.edits[0]
  assert.equal(written.providers.openai.apiKeyEnv, API_REF)
  assert.deepEqual(written.providers.openai.models, [{ id: 'gpt-6.2-sol', contextWindow: 500000 }], 'route content is preserved')
  assert.equal(written.providers.kimi.apiKeyEnv, 'KIMI_CODING_API_KEY', 'other providers are preserved')
})

test('a route defined only by an inherited layer is still switchable', async () => {
  const editor = fakeEditor({})
  editor.rows[0].inherited = providerConfig()
  const store = configEditorStore(editor)
  assert.equal(await store.currentApiKeyEnv(), PLAN_REF)
  await store.setApiKeyEnv(API_REF)
  const written = editor.edits[0]
  assert.equal(written.providers.openai.apiKeyEnv, API_REF)
  assert.equal(written.providers.kimi.apiKeyEnv, 'KIMI_CODING_API_KEY', 'inherited siblings survive the explicit write')
})

test('a profile without the route cannot be switched', async () => {
  const editor = fakeEditor({ providers: { kimi: { apiKeyEnv: 'KIMI_CODING_API_KEY' } } })
  const store = configEditorStore(editor)
  assert.equal(await store.currentApiKeyEnv(), undefined)
  await assert.rejects(() => store.setApiKeyEnv(API_REF), error => error.code === 'NO_OPENAI_ROUTE' && error.status === 409)
})

test('a failed profile write is reported as a configuration failure', async () => {
  const editor = fakeEditor(providerConfig())
  editor.edit = async () => { throw new Error('read-only profile') }
  const store = configEditorStore(editor)
  await assert.rejects(() => store.setApiKeyEnv(API_REF), error => error.code === 'CONFIG_WRITE_FAILED' && error.status === 409)
})

test('no editor means no store', () => {
  assert.equal(configEditorStore(undefined), undefined)
})

test('unexpected credential-describe failures do not claim an API key exists', async () => {
  const controller = new AuthModeController({
    store: fakeStore(PLAN_REF),
    credentials: { async describe() { throw new Error('seam unavailable') } },
    service: fakeService(true),
  })
  assert.equal((await controller.state()).apiKeyAvailable, false)
  await assert.rejects(() => controller.switch('api'), error => error.code === 'API_KEY_MISSING')
})
