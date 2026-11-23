import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'
import test from 'node:test'

const source = !!process.env.DSH_TEST_SOURCE
if (source) {
  const src = new URL('../src/', import.meta.url).href
  const hook = registerHooks({
    resolve(specifier, context, next) {
      return next(context.parentURL?.startsWith(src) && /^\.\/.+\.js$/.test(specifier) ? specifier.slice(0, -3) + '.ts' : specifier, context)
    },
  })
  await import('../src/oauth-http.ts')
  hook.deregister()
}
const { handleOAuthRequest } = await import(source ? '../src/oauth-http.ts' : '../lib/oauth-http.js')
const { SiwcServiceError } = await import(source ? '../src/siwc-service.ts' : '../lib/siwc-service.js')

const headers = { host: '127.0.0.1:1456', origin: 'http://127.0.0.1:1456', 'sec-fetch-site': 'same-origin', cookie: 'signed-browser-fixture' }
const browserPeer = {}
const localOperator = {}
const binding = { clientId: 'one', subject: 'subject-one' }
const connection = {
  browserPeer,
  admit({ headers }) {
    if (headers.cookie === 'signed-browser-fixture') return { peer: browserPeer }
    if (headers.cookie === 'signed-api-fixture') return { peer: localOperator }
    return { rejection: 401 }
  },
}
const service = {
  async status() { return { authenticated: true, email: 'test@example.com', activeClientId: 'one', activeSubject: 'subject-one', planUsage: 'enabled', models: [], login: { state: 'idle' } } },
  async login(options) { return { authUrl: `http://127.0.0.1:4321/auth/start/${options.clientId ?? 'new'}` } },
  async cancelLogin() { return { ok: true } },
  async logout() { return { ok: true, revocation: 'unconfirmed' } },
  async listAccounts() { return [{ clientId: 'one', label: 'one' }] },
  async selectAccount(clientId) { assert.equal(clientId, 'one'); return { authUrl: 'http://127.0.0.1:4321/auth/start/' + 's'.repeat(43) } },
  async listModelCatalog() { return { identity: binding, models: [{ id: 'a', name: 'Official A' }] } },
  async saveModelCache(identity, models, cache) { assert.deepEqual(identity, binding); return cache.save(models.map(({ id }) => ({ id, name: 'Official A' }))) },
  async acknowledgeWelcome(clientId, subject) { assert.equal(clientId, 'one'); assert.equal(subject, 'subject-one'); return { ok: true } },
  async resumeUsage(clientId, subject) { assert.equal(clientId, 'one'); assert.equal(subject, 'subject-one'); return { ok: true } },
}
async function request(method, path, { h = headers, peer = '127.0.0.1', data, raw, target = service, cache, onModelsRefresh, auth = connection, authMode, protocol = 'http:' } = {}) {
  const req = Readable.from(raw !== undefined ? [raw] : data === undefined ? [] : [JSON.stringify(data)])
  Object.assign(req, { method, url: `/api/openai-oauth${path}`, headers: h, socket: { remoteAddress: peer } })
  const res = { writeHead(status, h) { this.status = status; this.headers = h }, end(body) { this.body = JSON.parse(body) } }
  await handleOAuthRequest(target, req, res, { connection: auth, protocol, cache, onModelsRefresh, authMode })
  return res
}

test('status and account APIs do not cache or expose credentials', async () => {
  const status = await request('GET', '/status', { h: { host: headers.host, cookie: headers.cookie } })
  assert.equal(status.status, 200)
  assert.equal(status.headers['cache-control'], 'no-store')
  assert.equal(status.body.planUsage, 'enabled')
  assert.equal(status.body.activeClientId, 'one')
  assert.equal(status.body.activeSubject, 'subject-one')
  assert.deepEqual((await request('GET', '/accounts')).body.accounts, [{ clientId: 'one', label: 'one' }])
  const select = await request('POST', '/accounts/select', { data: { clientId: 'one' } })
  assert.deepEqual(select.body, { authUrl: 'http://127.0.0.1:4321/auth/start/' + 's'.repeat(43) })
  assert.equal(select.headers['cache-control'], 'no-store')
  assert.deepEqual((await request('POST', '/login', { data: { clientId: 'one' } })).body, { authUrl: 'http://127.0.0.1:4321/auth/start/one' })
  assert.deepEqual((await request('POST', '/login/cancel')).body, { ok: true })
  assert.deepEqual((await request('POST', '/logout')).body, { ok: true, revocation: 'unconfirmed' })
  const noSession = { ...service, async logout() { return { ok: true, revocation: 'not_applicable' } } }
  assert.deepEqual((await request('POST', '/logout', { target: noSession })).body, { ok: true, revocation: 'not_applicable' })
})

test('rejects missing Origin, cross site, nonloopback peer, and forged host', async () => {
  for (const h of [
    { host: headers.host },
    { ...headers, origin: 'http://attacker.test' },
    { ...headers, 'sec-fetch-site': 'same-site' },
    { ...headers, 'sec-fetch-site': 'cross-site' },
    { ...headers, host: 'localhost.attacker.test' },
    { ...headers, host: 'attacker@127.0.0.1:1456' },
    { ...headers, origin: 'http://127.0.0.1:1456/path' },
  ]) assert.equal((await request('POST', '/logout', { h })).status, 403)
  assert.equal((await request('GET', '/status', { peer: '192.0.2.1' })).status, 403)
  assert.equal((await request('POST', '/logout', { h: { host: headers.host, origin: headers.origin, cookie: headers.cookie } })).status, 200)
  assert.equal((await request('GET', '/status', { h: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403)
})

test('all OAuth methods require the DSH browser peer before reading or changing account state', async () => {
  const apiRoutes = [
    ['GET', '/status?light=1'], ['GET', '/accounts'], ['GET', '/models'], ['GET', '/models/cache'],
    ['POST', '/models/cache'], ['POST', '/accounts/select'], ['POST', '/login'],
    ['POST', '/login/cancel'], ['POST', '/logout'], ['POST', '/welcome/ack'], ['POST', '/usage/resume'],
  ]
  const target = new Proxy({}, { get() { assert.fail('unauthorized request reached the OAuth service') } })
  for (const [method, path] of apiRoutes) {
    for (const [cookie, expected] of [[undefined, 401], ['forged', 401], ['signed-api-fixture', 403]]) {
      const result = await request(method, path, { h: { ...headers, cookie }, target })
      assert.equal(result.status, expected, `${method} ${path}`)
      assert.equal(result.headers['cache-control'], 'no-store')
      assert.equal(result.body.code, 'HARNESS_AUTH_REQUIRED')
    }
  }
  const openingTicket = await request('GET', '/status?token=launch-ticket', { h: { ...headers, cookie: undefined }, target })
  assert.equal(openingTicket.status, 401)
  const unavailable = await request('GET', '/status', { auth: { admit() { throw new Error('auth unavailable') } }, target })
  assert.equal(unavailable.status, 503)
})

test('matches the mounted TLS scheme and passes pending-only logout through', async () => {
  let options
  const target = { ...service, async logout(input) { options = input; return { ok: true, revocation: 'confirmed' } } }
  const h = { ...headers, origin: 'https://127.0.0.1:1456' }
  assert.equal((await request('POST', '/logout', { h, protocol: 'https:', data: { pendingOnly: true }, target })).status, 200)
  assert.deepEqual(options, { pendingOnly: true })
  assert.equal((await request('POST', '/logout', { h: headers, protocol: 'https:', target })).status, 403)
  assert.equal((await request('POST', '/logout', { data: { pendingOnly: 'yes' }, target })).status, 400)
})

test('model catalog endpoint delegates to the service and never leaks a token', async () => {
  const expected = { identity: binding, models: [{ id: 'a', name: 'Official A' }] }
  assert.deepEqual((await request('GET', '/models')).body, expected)
  const failed = { ...service, async listModelCatalog() { throw new Error('unavailable') } }
  const response = await request('GET', '/models', { target: failed })
  assert.equal(response.status, 500)
  assert.deepEqual(response.body, { error: 'OAuth request failed.' })
})

test('light status and subject-bound welcome acknowledgement reach the service', async () => {
  const calls = []
  const target = { ...service, async status(options) { calls.push(options); return { welcomePending: true } } }
  assert.equal((await request('GET', '/status?light=1', { target })).body.welcomePending, true)
  await request('GET', '/status', { target })
  assert.deepEqual(calls, [{ light: true }, { light: false }])
  assert.deepEqual((await request('POST', '/welcome/ack', { data: { clientId: 'one', subject: 'subject-one' } })).body, { ok: true })
  for (const data of [{}, { clientId: 'one' }, { clientId: '', subject: 'subject-one' }, { clientId: 'one', subject: 1 }]) {
    assert.equal((await request('POST', '/welcome/ack', { data })).status, 400)
  }
  const changed = { ...service, async acknowledgeWelcome() { throw new SiwcServiceError('secret subject', 'ACCOUNT_CHANGED', 409) } }
  const result = await request('POST', '/welcome/ack', { target: changed, data: { clientId: 'one', subject: 'subject-one' } })
  assert.deepEqual(result.body, { error: 'OAuth request failed.', code: 'ACCOUNT_CHANGED' })
  assert.equal(result.status, 409)
})

test('authentication-mode endpoints delegate the switch and sanitize its errors', async () => {
  const switched = []
  const authMode = {
    async state() { return { mode: 'plan', apiKeyAvailable: true, signedIn: true, canSwitch: true } },
    async switch(mode) { switched.push(mode); return { mode, apiKeyAvailable: true, signedIn: true, canSwitch: true } },
  }
  assert.deepEqual((await request('GET', '/auth-mode', { authMode })).body, { mode: 'plan', apiKeyAvailable: true, signedIn: true, canSwitch: true })
  const api = await request('POST', '/auth-mode', { authMode, data: { mode: 'api' } })
  assert.equal(api.status, 200)
  assert.equal(api.body.mode, 'api')
  assert.deepEqual(switched, ['api'])
  const invalid = await request('POST', '/auth-mode', { authMode, data: { mode: 'browser' } })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.code, 'INVALID_MODE')
  assert.deepEqual(switched, ['api'], 'an invalid mode is refused before reaching the controller')
  assert.deepEqual((await request('GET', '/auth-mode')).body, { mode: 'missing', apiKeyAvailable: false, signedIn: false, canSwitch: false })
  const noEditor = await request('POST', '/auth-mode', { data: { mode: 'plan' } })
  assert.equal(noEditor.status, 409)
  assert.equal(noEditor.body.code, 'NO_CONFIG_EDITOR')
  const refusing = { async state() { return {} }, async switch() { throw new SiwcServiceError('internal detail', 'API_KEY_MISSING', 409) } }
  const refused = await request('POST', '/auth-mode', { authMode: refusing, data: { mode: 'api' } })
  assert.equal(refused.status, 409)
  assert.deepEqual(refused.body, { error: 'No OpenAI API key is stored under OPENAI_API_KEY.', code: 'API_KEY_MISSING' })
})

test('rejects invalid inputs and sanitizes unexpected errors', async () => {
  assert.equal((await request('POST', '/accounts/select', { data: {} })).status, 400)
  assert.equal((await request('POST', '/login', { data: { clientId: 5 } })).status, 400)
  assert.equal((await request('POST', '/login', { raw: '{invalid' })).status, 400)
  assert.equal((await request('POST', '/login', { raw: 'x'.repeat(65_537) })).status, 400)
  assert.equal((await request('GET', '/unknown')).status, 404)
  const bad = { ...service, async logout() { throw new Error('secret-token') } }
  const response = await request('POST', '/logout', { target: bad })
  assert.equal(response.status, 500)
  assert.doesNotMatch(JSON.stringify(response.body), /secret-token/)
  const safe = { ...service, async logout() { throw new SiwcServiceError('Safe message', 'TEST_CODE', 409, 'req-1') } }
  assert.deepEqual((await request('POST', '/logout', { target: safe })).body, { error: 'OAuth request failed.', code: 'TEST_CODE' })
})
