import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import test from 'node:test'
// Opt into source testing without generating or overwriting lib artifacts.
if (process.env.DSH_TEST_SOURCE) {
  const { registerHooks } = await import('node:module')
  registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.includes('/src/') && specifier.startsWith('./') && specifier.endsWith('.js')) {
      return next(specifier.slice(0, -3) + '.ts', context)
    }
    return next(specifier, context)
  } })
}
const source = !!process.env.DSH_TEST_SOURCE
const { SiwcService: Service } = await import(source ? '../src/siwc-service.ts' : '../lib/siwc-service.js')
const { SIWC_DISCOVERY, SIWC_ISSUER, SIWC_JWKS, SIWC_TOKEN, SIWC_REVOCATION } = await import(source ? '../src/siwc-auth.ts' : '../lib/siwc-auth.js')
// The plugin no longer owns a Codex app-server or a turn gate; the retained
// gate-serialization tests use a pass-through stand-in with the same shape.
class AppServer {
  tail = Promise.resolve()
  run(operation) {
    const next = this.tail.then(operation, operation)
    this.tail = next.then(() => {}, () => {})
    return next
  }
  accountRead(operation) { return this.run(operation) }
  accountChange(operation) { return this.run(operation) }
  close() {}
}

const savedExchanges = new WeakMap()
class SiwcService extends Service {
  constructor(store, options = {}) {
    const exchanges = new Map()
    const fetch = async (url, init) => {
      if (url === SIWC_TOKEN && init.body instanceof URLSearchParams) {
        const exchange = exchanges.get(init.body.get('code'))
        if (exchange) {
          assert.equal(init.body.get('client_id'), exchange.clientId)
          assert.equal(createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'), exchange.challenge)
          return json(exchange.tokens)
        }
      }
      if (url === SIWC_JWKS && exchanges.size) return json({ keys: [key] })
      if (url === SIWC_DISCOVERY && (options.fetch || exchanges.size)) return json({ issuer: SIWC_ISSUER, revocation_endpoint: SIWC_REVOCATION })
      if (url === SIWC_REVOCATION && !options.fetch && exchanges.size) return new Response(null, { status: 200 })
      return (options.fetch ?? globalThis.fetch)(url, init)
    }
    super(store, Object.create(options, { fetch: { value: fetch } }))
    savedExchanges.set(this, exchanges)
  }
}

const NOW = 1790000000000
const direct = 'chatgpt.tokens.use.direct'
const account = (id = 'client-a', scopes = [direct]) => ({ clientId: id, issuer: 'https://auth.openai.com', subject: `subject-${id}`, email: `${id}@example.com`, accessToken: 'access-secret', refreshToken: 'refresh-secret', idToken: 'id-secret', expiresAt: NOW + 3600000, scopes })
function store(initial = { hostId: 'host', accounts: [], activeClientId: undefined }) {
  let state = structuredClone(initial), queue = Promise.resolve()
  return {
    async read() { return structuredClone(state) },
    modify(update) { const result = queue.then(async () => { const next = await update(structuredClone(state)); if (next !== undefined) state = structuredClone(next) }); queue = result.catch(() => {}); return result },
  }
}
const initial = (scopes = [direct]) => ({ hostId: 'host', accounts: [account('client-a', scopes)], activeClientId: 'client-a' })
const activeBinding = { clientId: 'client-a', subject: 'subject-client-a' }
const gate = async fn => fn()
function json(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers }) }

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'key', use: 'sig', alg: 'RS256' }
function jwt(nonce, { aud = 'client-new', sub = 'subject-new' } = {}) {
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url')
  const data = `${encode({ alg: 'RS256', kid: 'key' })}.${encode({ iss: 'https://auth.openai.com', aud, sub, iat: NOW / 1000, exp: NOW / 1000 + 3600, nonce, email: 'new@example.com' })}`
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`
}

async function launch(url) {
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/auth\/start\/[A-Za-z0-9_-]{43}$/)
  const response = await fetch(url, { redirect: 'manual' })
  assert.equal(response.status, 303)
  return response.headers.get('location')
}

async function callback(url, clientId = 'client-new', code = 'code') {
  const auth = new URL(url), cb = new URL(auth.searchParams.get('redirect_uri'))
  cb.searchParams.set('state', auth.searchParams.get('state'))
  if (clientId !== null) cb.searchParams.set('client_id', clientId)
  cb.searchParams.set('code', code)
  return fetch(cb)
}

async function acceptSavedAuthorization(service, target, auth, overrides = {}) {
  const code = randomUUID()
  const { sub = target.subject, aud = target.clientId, nonce = auth.searchParams.get('nonce'), ...tokens } = overrides
  savedExchanges.get(service).set(code, {
    clientId: target.clientId,
    challenge: auth.searchParams.get('code_challenge'),
    tokens: {
      access_token: target.accessToken, refresh_token: target.refreshToken, token_type: 'Bearer', expires_in: 3600,
      scope: target.scopes.join(' '), id_token: jwt(nonce, { aud, sub }), ...tokens,
    },
  })
  assert.equal((await callback(auth, null, code)).status, 200)
}

async function startSavedSwitch(service, target) {
  return new URL(await launch((await service.selectAccount(target.clientId)).authUrl))
}

async function finishSavedSwitch(service, target) {
  await acceptSavedAuthorization(service, target, await startSavedSwitch(service, target))
  const settled = await loginSettled(service)
  assert.equal(settled.login.state, 'idle')
  assert.equal(settled.activeClientId, target.clientId)
}

async function loginSettled(service) {
  for (let i = 0; i < 100; i++) {
    const status = await service.status({ light: true })
    if (status.login.state !== 'pending') return status
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('Login did not settle')
}

test('status, identities and account labels reflect granted scopes and persisted active account', async () => {
  const s = store(initial([]))
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate })
  assert.deepEqual(await svc.status(), { authenticated: true, email: 'client-a@example.com', activeClientId: 'client-a', activeSubject: 'subject-client-a', planUsage: 'disabled', pendingRegistration: false, welcomePending: false, login: { state: 'idle' } })
  assert.equal((await svc.getIdentity()).subject, 'subject-client-a')
  assert.equal((await svc.listAccounts())[0].label, 'client-a@example.com (client-a)')
  await assert.rejects(() => svc.getAccessToken(), /permission not granted/)
  const reloaded = new SiwcService(s, { now: () => NOW, withAccountChange: gate })
  assert.equal((await reloaded.status()).authenticated, true)
  assert.equal((await new SiwcService(store()).status()).planUsage, 'unknown')
})

test('fixed model endpoint filters visibility and preserves order without exposing token', async () => {
  const calls = []
  const svc = new SiwcService(store(initial()), { now: () => NOW, withAccountRead: gate, fetch: async (url, init) => {
    calls.push([url, init])
    return json({ data: [ { slug: 'b', display_name: 'Bee', visibility: 'list' }, { slug: 'secret', visibility: 'hidden' }, { slug: 'a', visibility: 'list' }, { slug: 'x' } ] })
  } })
  assert.deepEqual(await svc.listModels(), [{ id: 'b', name: 'Bee' }, { id: 'a', name: 'a' }])
  assert.equal(calls[0][0], 'https://api.openai.com/v1/models')
  assert.equal(calls[0][1].method, 'GET')
  assert.equal(calls[0][1].redirect, 'error')
  assert.equal(calls[0][1].headers.authorization, 'Bearer access-secret')
  const status = await svc.status()
  assert.equal(status.planUsage, 'enabled')
  assert.doesNotMatch(JSON.stringify(status), /access-secret|refresh-secret|id-secret/)
})

test('uses the official models array even when a legacy data array is present', async () => {
  const svc = new SiwcService(store(initial()), { now: () => NOW, withAccountRead: gate, fetch: async () => json({
    models: [
      { slug: 'official-b', display_name: 'Official B', visibility: 'list' },
      { slug: 'hidden', visibility: 'hidden' },
      { slug: 'official-a', display_name: 'Official A', visibility: 'list' },
    ],
    data: [{ slug: 'legacy', visibility: 'list' }],
  }) })
  assert.deepEqual(await svc.listModels(), [{ id: 'official-b', name: 'Official B' }, { id: 'official-a', name: 'Official A' }])
})

test('never exposes a bearer echoed in visible catalog fields', async () => {
  for (const model of [
    { slug: 'prefix-access-secret-suffix', display_name: 'safe', visibility: 'list' },
    { slug: 'safe', display_name: 'prefix-access-secret-suffix', visibility: 'list' },
  ]) {
    const svc = new SiwcService(store(initial()), { now: () => NOW, withAccountRead: gate, fetch: async () => json({ models: [model] }) })
    await assert.rejects(() => svc.listModels(), error => error.code === 'MODEL_INVALID_RESPONSE' && !JSON.stringify(error).includes('access-secret'))
  }
})

test('rejects a catalog when the account token changes during discovery', async () => {
  const s = store(initial()), entered = deferred(), release = deferred()
  const svc = new SiwcService(s, { now: () => NOW, withAccountRead: gate, fetch: async () => {
    entered.resolve(); await release.promise
    return json({ models: [{ slug: 'a', visibility: 'list' }] })
  } })
  const request = svc.listModels()
  await entered.promise
  await s.modify(async state => ({ ...state, accounts: state.accounts.map(account => ({ ...account, accessToken: 'new-access' })) }))
  release.resolve()
  await assert.rejects(request, error => error.code === 'ACCOUNT_CHANGED')
})

test('reconciles credentials instead of trusting a stale catalog read', async () => {
  const original = store(initial())
  let stale = false
  const s = {
    async read() {
      const state = await original.read()
      if (stale) state.accounts[0].accessToken = 'access-secret'
      return state
    },
    modify: update => original.modify(update),
  }
  const svc = new SiwcService(s, { now: () => NOW, withAccountRead: gate, fetch: async () => {
    await original.modify(async state => ({ ...state, accounts: state.accounts.map(account => ({ ...account, accessToken: 'new-access' })) }))
    stale = true
    return json({ models: [{ slug: 'a', visibility: 'list' }] })
  } })
  await assert.rejects(() => svc.listModels(), error => error.code === 'ACCOUNT_CHANGED')
})

test('status is local-only and reports subject flags without a network call', async () => {
  let calls = 0
  const s = store({ ...initial(), subjectStates: [{ subject: 'subject-client-a', planUsed: true }] })
  const svc = new SiwcService(s, { now: () => NOW, withAccountRead: gate, fetch: async () => { calls++; return json({ data: [{ slug: 'a', visibility: 'list' }] }) } })
  const light = await svc.status({ light: true })
  assert.equal(light.activeClientId, 'client-a')
  assert.equal(light.activeSubject, 'subject-client-a')
  assert.equal(light.welcomePending, true)
  assert.equal(calls, 0)
  assert.equal((await svc.status()).authenticated, true)
  assert.equal(calls, 0, 'a full status read never reaches OpenAI')
})

test('model errors preserve safe code and request id, never response secrets', async () => {
  for (const status of [401, 403, 429, 503]) {
    const svc = new SiwcService(store(initial()), { now: () => NOW, withAccountRead: gate, fetch: async () => json({ error: { code: 'upstream_code', message: 'access-secret' } }, status, { 'x-request-id': 'req-123' }) })
    await assert.rejects(() => svc.listModels(), error => {
      assert.equal(error.status, status); assert.equal(error.code, 'upstream_code'); assert.equal(error.requestId, 'req-123')
      assert.doesNotMatch(JSON.stringify(error), /access-secret/); return true
    })
  }
  const malicious = new SiwcService(store(initial()), { now: () => NOW, withAccountRead: gate, fetch: async () => json({ error: { code: 'access-secret' } }, 401, { 'x-request-id': 'access-secret' }) })
  await assert.rejects(() => malicious.listModels(), error => error.code === 'MODEL_UNAUTHORIZED' && error.requestId === undefined)
})

test('switching a saved account keeps the previous grant until OAuth verifies and commits', async t => {
  const a = account(), b = account('client-b')
  const s = store({ ...initial(), accounts: [a, b] })
  const entered = deferred(), release = deferred()
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: async commit => {
    entered.resolve()
    await release.promise
    return commit()
  } })
  t.after(async () => { release.resolve(); await svc.close() })
  const noGate = new SiwcService(store({ hostId: 'host', accounts: [account()] }))
  await assert.rejects(() => noGate.selectAccount('client-a'), /turn safety/)
  await assert.rejects(() => svc.selectAccount('missing'), { code: 'ACCOUNT_UNAVAILABLE' })

  const first = await startSavedSwitch(svc, b)
  assert.equal(first.searchParams.get('client_id'), b.clientId)
  assert.equal(first.searchParams.get('ext_agent_host_id'), 'host')
  assert.equal(first.searchParams.get('id_token_hint'), b.idToken)
  assert.equal(first.searchParams.get('login_hint'), b.email)
  assert.equal(first.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(first.searchParams.has('prompt'), false)
  assert.equal(first.searchParams.has('agent_name_hint'), false)
  assert.equal((await svc.status({ light: true })).login.state, 'pending')
  assert.equal((await s.read()).activeClientId, a.clientId)
  await assert.rejects(() => svc.selectAccount(a.clientId), { code: 'LOGIN_PENDING' })
  await svc.cancelLogin()
  assert.equal((await s.read()).activeClientId, a.clientId)

  for (const claims of [{ sub: a.subject }, { aud: a.clientId }, { nonce: 'wrong-nonce' }]) {
    const invalid = await startSavedSwitch(svc, b)
    for (const key of ['state', 'nonce', 'code_challenge']) assert.notEqual(invalid.searchParams.get(key), first.searchParams.get(key))
    await acceptSavedAuthorization(svc, b, invalid, { ...claims, refresh_token: 'rejected-test-grant' })
    assert.equal((await loginSettled(svc)).login.state, 'failed')
    const state = await s.read()
    assert.equal(state.activeClientId, a.clientId)
    assert.equal(state.accounts.find(account => account.clientId === b.clientId).refreshToken, b.refreshToken)
  }

  const authorized = await startSavedSwitch(svc, b)
  await acceptSavedAuthorization(svc, b, authorized, { access_token: 'new-b-access', refresh_token: 'new-b-refresh' })
  await entered.promise
  assert.equal((await s.read()).activeClientId, a.clientId)
  release.resolve()
  assert.equal((await loginSettled(svc)).activeClientId, b.clientId)
  assert.equal(await svc.getAccessToken(), 'new-b-access')
  assert.deepEqual((await s.read()).accounts.find(account => account.clientId === a.clientId), a)
})

test('a late verified switch cannot displace an account selected by another process', async t => {
  const a = account(), b = account('client-b'), c = account('client-c')
  const s = store({ ...initial(), accounts: [a, b, c] })
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate })
  const other = new SiwcService(s, { now: () => NOW, withAccountChange: gate })
  t.after(() => Promise.all([svc.close(), other.close()]))
  const pending = await startSavedSwitch(svc, b)
  await finishSavedSwitch(other, c)
  await acceptSavedAuthorization(svc, b, pending, { refresh_token: 'late-test-grant' })
  assert.equal((await loginSettled(svc)).login.state, 'failed')
  assert.equal((await s.read()).activeClientId, c.clientId)
})

test('login is nonblocking and verified callback activates inside turn gate', async () => {
  const s = store(), calls = []
  let authUrl
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: async fn => { calls.push('gate'); return fn() }, fetch: async (url) => {
    if (url === SIWC_JWKS) return json({ keys: [key] })
    if (url === SIWC_TOKEN) return json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope: `openid ${direct}`, id_token: jwt(new URL(authUrl).searchParams.get('nonce')) })
    if (url === SIWC_REVOCATION) return new Response(null, { status: 200 })
    if (url === 'https://api.openai.com/v1/models') return json({ data: [] })
    throw Error('unexpected request')
  } })
  const launchUrl = (await svc.login()).authUrl
  authUrl = await launch(launchUrl)
  assert.equal((await fetch(launchUrl, { redirect: 'manual' })).status, 410)
  assert.equal((await svc.status()).login.state, 'pending')
  assert.equal((await callback(authUrl)).status, 200)
  for (let i = 0; i < 100 && (await svc.status()).login.state === 'pending'; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await svc.status()).login.state, 'idle')
  assert.equal((await s.read()).activeClientId, 'client-new')
  assert.deepEqual(calls, ['gate'])
  assert.equal((await svc.status()).welcomePending, true) // No inference has run.
  assert.equal((await s.read()).subjectStates?.[0]?.planUsed, undefined)
  await svc.acknowledgeWelcome('client-new', 'subject-new')
  assert.equal((await svc.status()).welcomePending, false)
  assert.deepEqual(await svc.logout(), { ok: true, revocation: 'confirmed' })
  assert.equal((await svc.status()).welcomePending, false)
  authUrl = await launch((await svc.login()).authUrl)
  assert.equal((await callback(authUrl)).status, 200)
  for (let i = 0; i < 100 && (await svc.status()).login.state === 'pending'; i++) await new Promise(resolve => setImmediate(resolve))
  const again = await svc.status()
  assert.equal(again.login.state, 'idle')
  assert.equal(again.activeSubject, 'subject-new')
  assert.equal(again.welcomePending, false)
  await svc.close()
})

test('login after sign-out reuses the last active client and host', async () => {
  const s = store({ hostId: 'host', accounts: [account('client-a')], activeClientId: undefined, lastActiveClientId: 'client-a' })
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate })
  try {
    const { authUrl } = await svc.login()
    const authorization = new URL(await launch(authUrl))
    assert.equal(authorization.searchParams.get('client_id'), 'client-a')
    assert.equal(authorization.searchParams.get('ext_agent_host_id'), 'host')
    assert.equal(authorization.searchParams.get('agent_name_hint'), null)
    assert.ok(authorization.searchParams.get('id_token_hint'))
  } finally { await svc.cancelLogin() }
})

test('pending registration retry reuses the unverified issued client', async () => {
  const s = store({ hostId: 'host', accounts: [], pendingRegistration: { generation: 'pending', clientId: 'oaiapp_pending', quarantinedRefreshTokens: ['refresh-secret'], revocationUnconfirmed: true } })
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate })
  try {
    const { authUrl } = await svc.login({ retryRegistration: true })
    const authorization = new URL(await launch(authUrl))
    assert.equal(authorization.searchParams.get('client_id'), 'oaiapp_pending')
    assert.equal(authorization.searchParams.get('agent_name_hint'), null)
    assert.equal(authorization.searchParams.get('ext_agent_host_id'), 'host')
  } finally { await svc.cancelLogin() }
})

test('a definitive invalid_client allows a new registration and keeps the same host', async t => {
  const s = store(), called = []
  const svc = new SiwcService(s, { withAccountChange: gate, fetch: async (url, init) => {
    assert.equal(url, SIWC_TOKEN)
    called.push(init.body.get('client_id'))
    return json({ error: 'invalid_client' }, 401)
  } })
  t.after(() => svc.close())
  const first = new URL(await launch((await svc.login({ newAccount: true })).authUrl))
  assert.equal((await callback(first, 'rejected-client')).status, 200)
  const failed = await loginSettled(svc)
  assert.equal(failed.login.code, 'invalid_client')
  assert.equal(failed.pendingRegistration, false)
  assert.deepEqual(called, ['rejected-client'])
  const fresh = new URL(await launch((await svc.login({ newAccount: true })).authUrl))
  assert.equal(fresh.searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(fresh.searchParams.get('ext_agent_host_id'), first.searchParams.get('ext_agent_host_id'))
})

test('an uncertain but rejected registration can be cleaned independently of a fresh account', async t => {
  const rejected = 'rejected-client', s = store({ hostId: 'host', accounts: [],
    pendingRegistration: { generation: 'old', clientId: rejected, revocationUnconfirmed: true, quarantinedRefreshTokens: ['old-known-token'] } })
  const revoked = []
  let authorization
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate, fetch: async (url, init) => {
    if (url === SIWC_REVOCATION) {
      revoked.push([init.body.get('client_id'), init.body.get('token')])
      return new Response(null, { status: 200 })
    }
    if (url === SIWC_JWKS) return json({ keys: [key] })
    assert.equal(url, SIWC_TOKEN)
    if (init.body.get('client_id') === rejected) return json({ error: 'invalid_client' }, 401)
    return json({ id_token: jwt(authorization.searchParams.get('nonce')), scope: 'openid profile email' })
  } })
  t.after(() => svc.close())
  const retry = new URL(await launch((await svc.login({ retryRegistration: true })).authUrl))
  assert.equal(retry.searchParams.get('client_id'), rejected)
  assert.equal((await callback(retry, null)).status, 200)
  const failed = await loginSettled(svc)
  assert.equal(failed.pendingRegistration, false)
  assert.equal(failed.pendingRevocation, true)
  assert.equal(failed.login.code, 'invalid_client')
  assert.equal((await s.read()).detachedRegistrations[0].clientId, rejected)
  authorization = new URL(await launch((await svc.login({ newAccount: true })).authUrl))
  assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(authorization.searchParams.get('ext_agent_host_id'), 'host')
  assert.equal((await callback(authorization)).status, 200)
  assert.equal((await loginSettled(svc)).activeClientId, 'client-new')
  assert.deepEqual(await svc.logout({ pendingOnly: true }), { ok: true, revocation: 'unconfirmed' })
  assert.deepEqual(revoked, [[rejected, 'old-known-token']])
  assert.equal((await svc.status()).activeClientId, 'client-new')
  assert.equal((await svc.status()).pendingRevocation, true)
  assert.equal((await s.read()).detachedRegistrations[0].quarantinedRefreshTokens, undefined)
})

test('a verified identity-only grant stays signed in and can enable the plan later', async t => {
  const s = store()
  let authUrl, grantPlan = false
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate, fetch: async url => {
    if (url === SIWC_JWKS) return json({ keys: [key] })
    assert.equal(url, SIWC_TOKEN)
    const id_token = jwt(authUrl.searchParams.get('nonce'))
    return grantPlan ? json({ id_token, access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope: `openid offline_access ${direct}` })
      : json({ id_token, scope: 'openid profile email' })
  } })
  t.after(() => svc.close())
  authUrl = new URL(await launch((await svc.login({ newAccount: true })).authUrl))
  assert.equal((await callback(authUrl)).status, 200)
  const disabled = await loginSettled(svc)
  assert.equal(disabled.authenticated, true)
  assert.equal(disabled.planUsage, 'disabled')
  assert.equal(disabled.welcomePending, false)
  assert.equal((await svc.listAccounts())[0].signedIn, true)
  assert.equal((await s.read()).accounts[0].refreshToken, undefined)
  await assert.rejects(svc.getAccessToken(), /permission not granted/)
  grantPlan = true
  authUrl = new URL(await launch((await svc.login({ clientId: 'client-new', enablePlan: true })).authUrl))
  assert.equal(authUrl.searchParams.get('client_id'), 'client-new')
  assert.equal(authUrl.searchParams.get('prompt'), 'consent')
  assert.equal(authUrl.searchParams.get('id_token_hint'), (await s.read()).accounts[0].idToken)
  assert.equal((await callback(authUrl, null)).status, 200)
  const enabled = await loginSettled(svc)
  assert.equal(enabled.planUsage, 'enabled')
  assert.equal(enabled.welcomePending, true)
  assert.equal(await svc.getAccessToken(), 'new-access')
})

test('logout cancels pending login, stops token issuance and reports failed revocation', async () => {
  const s = store(initial())
  let release, entered
  const ready = new Promise(resolve => { entered = resolve })
  const wait = new Promise(resolve => { release = resolve })
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate, beforeSignOut: async () => { entered(); await wait }, fetch: async url => {
    if (url === SIWC_REVOCATION) return new Response(null, { status: 400 })
    throw Error('unexpected request')
  } })
  await svc.login()
  const logout = svc.logout()
  await ready
  await assert.rejects(() => svc.getAccessToken(), /Sign-out/)
  release()
  assert.deepEqual(await logout, { ok: true, revocation: 'unconfirmed' })
  assert.equal((await s.read()).activeClientId, undefined)
  assert.equal((await s.read()).accounts[0].accessToken, undefined)
  assert.equal((await svc.status()).authenticated, false)
})

test('cancelLogin stops the pending attempt and admits a new one', async () => {
  const s = store({ hostId: 'host', accounts: [] })
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate })
  const first = await svc.login({ newAccount: true })
  assert.match(first.authUrl, /^http:\/\/127\.0\.0\.1:\d+\/auth\/start\//)
  assert.equal((await svc.status()).login.state, 'pending')
  assert.deepEqual(await svc.cancelLogin(), { ok: true })
  assert.equal((await svc.status()).login.state, 'idle')
  const second = await svc.login({ newAccount: true })
  assert.match(second.authUrl, /^http:\/\/127\.0\.0\.1:\d+\/auth\/start\//)
  assert.notEqual(second.authUrl, first.authUrl)
  await svc.cancelLogin()
})

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('identity uses one store snapshot and requires a verified signed-in account', async () => {
  const a = account('client-a'), b = account('client-b')
  const snapshots = [
    { hostId: 'host', accounts: [a, b], activeClientId: a.clientId },
    { hostId: 'host', accounts: [{ ...a, subject: 'wrong-subject' }, b], activeClientId: b.clientId },
  ]
  let reads = 0
  const changing = { async read() { return structuredClone(snapshots[Math.min(reads++, 1)]) }, async modify() { throw Error('unexpected write') } }
  assert.deepEqual(await new SiwcService(changing).getIdentity(), { clientId: a.clientId, subject: a.subject, email: a.email })
  assert.equal(reads, 1)
  for (const invalid of [
    { ...a, issuer: 'https://other.example' }, { ...a, subject: '' },
    { ...a, accessToken: undefined }, { ...a, refreshToken: undefined },
  ]) {
    assert.equal(await new SiwcService(store({ hostId: 'host', accounts: [invalid], activeClientId: a.clientId })).getIdentity(), undefined)
  }
  assert.equal(await new SiwcService(store()).getIdentity(), undefined)
})

test('catalog read serializes A→B→A account switches through the response body', async () => {
  const a = { ...account('client-a'), accessToken: 'token-a' }
  const b = { ...account('client-b'), accessToken: 'token-b' }
  const base = store({ hostId: 'host', accounts: [a, b], activeClientId: a.clientId })
  const secondRead = deferred(), releaseRead = deferred(), changeQueued = deferred()
  const fetchEntered = deferred(), releaseFetch = deferred(), bodyEntered = deferred(), releaseBody = deferred()
  let reads = 0
  const s = { ...base, async read() {
    if (++reads === 2) { secondRead.resolve(); await releaseRead.promise }
    return base.read()
  } }
  const server = new AppServer(), switches = [], headers = []
  const svc = new SiwcService(s, {
    now: () => NOW,
    withAccountRead: fn => server.accountRead(fn),
    withAccountChange: fn => {
      changeQueued.resolve()
      return server.accountChange(async () => {
        const before = (await base.read()).activeClientId
        const result = await fn()
        switches.push([before, (await base.read()).activeClientId])
        return result
      })
    },
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/models')
      headers.push(init.headers.authorization)
      fetchEntered.resolve()
      await releaseFetch.promise
      return { ok: true, async json() { bodyEntered.resolve(); await releaseBody.promise; return { data: [{ slug: 'model-a', visibility: 'list' }] } } }
    },
  })
  const listing = svc.listModels()
  await secondRead.promise // A identity was captured; token lookup is paused.
  await acceptSavedAuthorization(svc, b, await startSavedSwitch(svc, b))
  await changeQueued.promise
  assert.equal((await base.read()).activeClientId, a.clientId)
  assert.deepEqual(switches, [])
  releaseRead.resolve()
  await fetchEntered.promise
  assert.deepEqual(headers, ['Bearer token-a'])
  assert.deepEqual(switches, [])
  releaseFetch.resolve()
  await bodyEntered.promise
  assert.equal((await base.read()).activeClientId, a.clientId)
  assert.deepEqual(switches, [])
  releaseBody.resolve()
  assert.deepEqual(await listing, [{ id: 'model-a', name: 'model-a' }])
  assert.equal((await loginSettled(svc)).activeClientId, b.clientId)
  await finishSavedSwitch(svc, a)
  assert.deepEqual(switches, [[a.clientId, b.clientId], [b.clientId, a.clientId]])
  server.close()
})

test('expected identity prevents an outer A→B→A catalog mixup before token lookup', async () => {
  const a = { ...account('client-a'), accessToken: 'token-a' }, b = { ...account('client-b'), accessToken: 'token-b' }
  const base = store({ hostId: 'host', accounts: [a, b], activeClientId: a.clientId })
  let modifications = 0
  const s = { ...base, modify(fn) { modifications++; return base.modify(fn) } }
  const server = new AppServer(), entered = deferred(), release = deferred(), queued = deferred(), tokens = []
  let committedSelections = 0
  const svc = new SiwcService(s, { now: () => NOW,
    withAccountRead: fn => server.accountRead(fn),
    withAccountChange: fn => { if (++committedSelections === 2) queued.resolve(); return server.accountChange(fn) },
    fetch: async (_url, init) => { tokens.push(init.headers.authorization); return json({ data: [{ slug: 'model-a', visibility: 'list' }] }) },
  })
  const identity = await svc.getIdentity()
  const expected = `${identity.clientId}\u0000${identity.subject}`
  await finishSavedSwitch(svc, b)
  const holding = server.accountRead(async () => { entered.resolve(); await release.promise })
  await entered.promise
  const listing = svc.listModels(expected)
  await acceptSavedAuthorization(svc, a, await startSavedSwitch(svc, a))
  await queued.promise
  release.resolve()
  await holding
  await assert.rejects(listing, error => error.code === 'ACCOUNT_CHANGED' && error.status === 409)
  assert.equal((await loginSettled(svc)).activeClientId, a.clientId)
  assert.equal((await base.read()).activeClientId, a.clientId)
  const writesAfterSwitches = modifications
  assert.equal(committedSelections, 2)
  assert.deepEqual(tokens, [])
  await assert.rejects(() => svc.listModels(`${a.clientId}\u0000other-subject`), error => error.code === 'ACCOUNT_CHANGED')
  assert.equal(modifications, writesAfterSwitches)
  assert.deepEqual(await svc.listModels(expected), [{ id: 'model-a', name: 'model-a' }])
  assert.deepEqual(tokens, ['Bearer token-a'])
  server.close()
})

test('welcome requires direct scope and cannot be acknowledged without it', async () => {
  const a = account('client-a', []), s = store({ hostId: 'host', accounts: [a], activeClientId: a.clientId })
  const svc = new SiwcService(s, { withAccountChange: gate })
  assert.equal((await svc.status()).welcomePending, false)
  await assert.rejects(() => svc.acknowledgeWelcome(a.clientId, a.subject), error => error.code === 'PLAN_NOT_ENABLED' && error.status === 409)
  assert.equal((await s.read()).subjectStates, undefined)
  await s.modify(async state => ({ ...state, accounts: state.accounts.map(item => ({ ...item, scopes: [direct] })) }))
  assert.equal((await svc.status()).welcomePending, true)
  assert.deepEqual(await svc.acknowledgeWelcome(a.clientId, a.subject), { ok: true })
  assert.equal((await svc.status()).welcomePending, false)
  await s.modify(async state => ({ ...state, accounts: state.accounts.map(item => ({ ...item, scopes: [] })) }))
  assert.equal((await svc.status()).welcomePending, false)
  await s.modify(async state => ({ ...state, accounts: state.accounts.map(item => ({ ...item, scopes: [direct] })) }))
  assert.equal((await svc.status()).welcomePending, false)
  const unverified = new SiwcService(store({ hostId: 'host', accounts: [{ ...a, scopes: [direct], issuer: 'https://other.example' }], activeClientId: a.clientId }), { withAccountChange: gate })
  assert.equal((await unverified.status()).welcomePending, false)
  await assert.rejects(() => unverified.acknowledgeWelcome(a.clientId, a.subject), error => error.code === 'ACCOUNT_CHANGED')
})

test('welcome acknowledgement rechecks direct scope in the atomic update', async () => {
  const a = account(), s = store(initial()), entered = deferred(), release = deferred()
  const svc = new SiwcService(s, { withAccountChange: async fn => { entered.resolve(); await release.promise; return fn() } })
  assert.equal((await svc.status()).welcomePending, true)
  const ack = svc.acknowledgeWelcome(a.clientId, a.subject)
  await entered.promise
  await s.modify(async state => ({ ...state, accounts: state.accounts.map(item => ({ ...item, scopes: [] })) }))
  release.resolve()
  await assert.rejects(ack, error => error.code === 'PLAN_NOT_ENABLED')
  assert.equal((await s.read()).subjectStates, undefined)
  await s.modify(async state => ({ ...state, accounts: state.accounts.map(item => ({ ...item, scopes: [direct] })) }))
  assert.equal((await svc.status()).welcomePending, true)
})

test('welcome acknowledgement cannot mark a switched account or changed subject', async () => {
  const a = account('client-a'), b = account('client-b')
  const s = store({ hostId: 'host', accounts: [a, b], activeClientId: a.clientId,
    subjectStates: [{ subject: a.subject, planUsed: true }, { subject: b.subject, planUsed: true }] })
  const entered = deferred(), release = deferred()
  const svc = new SiwcService(s, { withAccountChange: async fn => { entered.resolve(); await release.promise; return fn() }, catalog: [{ id: 'local' }] })
  const shown = await svc.status()
  const acknowledgement = svc.acknowledgeWelcome(shown.activeClientId, shown.activeSubject)
  await entered.promise
  await s.modify(async state => ({ ...state, activeClientId: b.clientId }))
  release.resolve()
  await assert.rejects(acknowledgement, error => error.code === 'ACCOUNT_CHANGED' && error.status === 409)
  assert.equal((await svc.status()).welcomePending, true)
  await assert.rejects(() => svc.acknowledgeWelcome(b.clientId, a.subject), error => error.code === 'ACCOUNT_CHANGED')
  assert.equal((await svc.status()).welcomePending, true)
  await svc.acknowledgeWelcome(b.clientId, b.subject)
  assert.equal((await svc.status()).welcomePending, false)
  const noGate = new SiwcService(s)
  await assert.rejects(() => noGate.acknowledgeWelcome(b.clientId, b.subject), error => error.code === 'ACCOUNT_CHANGE_UNAVAILABLE')
})

test('logout reports no session and invalidates a credential-free active registration', async () => {
  const svc = new SiwcService(store(), { withAccountChange: gate })
  assert.deepEqual(await svc.logout(), { ok: true, revocation: 'not_applicable' })
  const emptyAccount = { ...account(), accessToken: undefined, refreshToken: undefined, idToken: undefined, generation: 'old' }
  const s = store({ hostId: 'host', accounts: [emptyAccount], activeClientId: emptyAccount.clientId,
    pendingRegistration: { clientId: 'pending-client', generation: 'old' } })
  const noSession = new SiwcService(s, { withAccountChange: gate })
  assert.deepEqual(await noSession.logout(), { ok: true, revocation: 'not_applicable' })
  const state = await s.read()
  assert.notEqual(state.accounts[0].generation, 'old')
  assert.notEqual(state.pendingRegistration.generation, 'old')
  assert.equal(state.accounts[0].revocationUnconfirmed, undefined)
})

test('another runtime cannot select, reauthorize or use an account after its logout marker commits', async t => {
  const s = store(initial()), marked = deferred(), release = deferred()
  const outgoing = { ...s, async modify(update) {
    await s.modify(update)
    if ((await s.read()).accounts[0].logoutPending) { marked.resolve(); await release.promise }
  } }
  const called = []
  const svc = new SiwcService(outgoing, { now: () => NOW, withAccountChange: gate, fetch: async (url, init) => {
    assert.equal(url, SIWC_REVOCATION)
    called.push(init.body.get('token'))
    return new Response(null, { status: 400 })
  } })
  const other = new SiwcService(s, { now: () => NOW, withAccountChange: gate })
  t.after(async () => { release.resolve(); await Promise.all([svc.close(), other.close()]) })
  const logout = svc.logout()
  await marked.promise
  assert.equal((await s.read()).activeClientId, undefined)
  assert.equal((await s.read()).accounts[0].refreshToken, 'refresh-secret')
  assert.equal((await other.status()).pendingRevocation, true)
  assert.equal((await other.listAccounts())[0].signedIn, false)
  await assert.rejects(other.selectAccount('client-a'), { code: 'LOGOUT_PENDING' })
  await assert.rejects(other.login({ clientId: 'client-a' }), { code: 'LOGOUT_PENDING' })
  await assert.rejects(other.getAccessToken(), { code: 'MISSING_CREDENTIAL' })
  assert.deepEqual(called, [])
  release.resolve()
  assert.deepEqual(await logout, { ok: true, revocation: 'unconfirmed' })
  assert.deepEqual(called, ['refresh-secret'])
  const after = await s.read()
  assert.equal(after.activeClientId, undefined)
  assert.equal(after.accounts[0].refreshToken, undefined)
  assert.equal(after.accounts[0].idToken, undefined)
  assert.equal(after.accounts[0].logoutPending, undefined)
  const newAuth = new URL(await launch((await other.login()).authUrl))
  assert.equal(newAuth.searchParams.get('client_id'), 'client-a')
  assert.equal(newAuth.searchParams.get('id_token_hint'), null)
  assert.equal(newAuth.searchParams.get('ext_agent_host_id'), 'host')
})

test('another runtime resumes durable logout and the stale worker cannot revoke a later sign-in', async t => {
  const a = account('client-new'), s = store({ hostId: 'host', accounts: [a], activeClientId: a.clientId })
  const marked = deferred(), release = deferred()
  const outgoing = { ...s, async modify(update) {
    await s.modify(update)
    if ((await s.read()).accounts[0].logoutPending) { marked.resolve(); await release.promise }
  } }
  const svc = new SiwcService(outgoing, { now: () => NOW, withAccountChange: gate, fetch: async () => { assert.fail('stale logout must not post to OpenAI') } })
  let authorization
  const revoked = []
  const other = new SiwcService(s, { now: () => NOW, withAccountChange: gate, fetch: async (url, init) => {
    if (url === SIWC_REVOCATION) { revoked.push(init.body.get('token')); return new Response(null, { status: 200 }) }
    if (url === SIWC_JWKS) return json({ keys: [key] })
    assert.equal(url, SIWC_TOKEN)
    return json({ id_token: jwt(authorization.searchParams.get('nonce'), { aud: a.clientId, sub: a.subject }), access_token: 'new-access', refresh_token: 'new-refresh',
      token_type: 'Bearer', expires_in: 3600, scope: direct })
  } })
  t.after(async () => { release.resolve(); await Promise.all([svc.close(), other.close()]) })
  const logout = svc.logout()
  await marked.promise
  assert.deepEqual(await other.logout({ pendingOnly: true }), { ok: true, revocation: 'confirmed' })
  assert.equal((await other.status()).pendingRevocation, undefined)
  authorization = new URL(await launch((await other.login()).authUrl))
  assert.equal((await callback(authorization, null)).status, 200)
  assert.equal((await loginSettled(other)).activeClientId, a.clientId)
  release.resolve()
  await logout
  assert.deepEqual(revoked, ['refresh-secret'])
  assert.equal((await s.read()).accounts[0].refreshToken, 'new-refresh')
  assert.equal(await other.getAccessToken(), 'new-access')
})

test('logout revokes pending registration credentials and combines revocation outcomes', async () => {
  for (const [active, pending, failedToken, expected] of [
    [false, { quarantinedRefreshTokens: ['pending-secret'] }, undefined, 'confirmed'],
    [false, { revocationUnconfirmed: true }, undefined, 'unconfirmed'],
    [false, { authorizationPending: ['exchange'] }, undefined, 'unconfirmed'],
    [true, { quarantinedRefreshTokens: ['pending-secret'] }, 'pending-secret', 'unconfirmed'],
    [true, { quarantinedRefreshTokens: ['pending-secret'] }, undefined, 'confirmed'],
  ]) {
    const tokens = []
    const s = store({ hostId: 'host', accounts: active ? [account()] : [], activeClientId: active ? 'client-a' : undefined,
      pendingRegistration: { generation: 'g', clientId: 'pending-client', ...pending } })
    const svc = new SiwcService(s, { withAccountChange: gate, fetch: async (url, init) => {
      assert.equal(url, SIWC_REVOCATION)
      const token = init.body.get('token'); tokens.push(token)
      return new Response(null, { status: token === failedToken ? 400 : 200 })
    } })
    assert.deepEqual(await svc.logout(), { ok: true, revocation: expected })
    const state = await s.read()
    assert.deepEqual(state.pendingRegistration.quarantinedRefreshTokens, failedToken ? ['pending-secret'] : undefined)
    if (pending.quarantinedRefreshTokens) assert.ok(tokens.includes('pending-secret'))
    if (active) assert.ok(tokens.includes('refresh-secret'))
  }
})

test('pending failed revocation remains quarantined for a later logout retry', async () => {
  const s = store({ hostId: 'host', accounts: [], pendingRegistration: { generation: 'g', clientId: 'pending-client', quarantinedRefreshTokens: ['retry-secret'] } })
  let allow = false, calls = 0
  const svc = new SiwcService(s, { withAccountChange: gate, fetch: async () => { calls++; return new Response(null, { status: allow ? 200 : 400 }) } })
  assert.deepEqual(await svc.logout(), { ok: true, revocation: 'unconfirmed' })
  assert.deepEqual((await s.read()).pendingRegistration.quarantinedRefreshTokens, ['retry-secret'])
  allow = true
  assert.deepEqual(await svc.logout(), { ok: true, revocation: 'confirmed' })
  assert.equal((await s.read()).pendingRegistration.quarantinedRefreshTokens, undefined)
  assert.equal(calls, 2)
})

test('logout during token exchange reports uncertainty and preserves late failed revocation', async t => {
  const s = store(), entered = deferred(), release = deferred(), stopping = deferred(), revoking = deferred(), revoked = []
  let authUrl
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate, beforeSignOut: async () => stopping.resolve(), fetch: async (url, init) => {
    if (url === SIWC_TOKEN) {
      entered.resolve(); await release.promise
      return json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope: `openid ${direct}`, id_token: jwt(new URL(authUrl).searchParams.get('nonce')) })
    }
    if (url === SIWC_JWKS) return json({ keys: [key] })
    if (url === SIWC_REVOCATION) { revoked.push(init.body.get('token')); revoking.resolve(); return new Response(null, { status: 400 }) }
    throw Error('unexpected request')
  } })
  t.after(async () => { release.resolve(); await svc.close() })
  authUrl = await launch((await svc.login()).authUrl)
  assert.equal((await callback(authUrl)).status, 200)
  await entered.promise
  const logout = svc.logout()
  await stopping.promise
  assert.deepEqual(await logout, { ok: true, revocation: 'unconfirmed' })
  assert.equal((await s.read()).pendingRegistration.authorizationPending.length, 1)
  release.resolve()
  await revoking.promise
  for (let i = 0; i < 100 && (await s.read()).pendingRegistration?.authorizationPending?.length; i++) await new Promise(resolve => setImmediate(resolve))
  const state = await s.read()
  assert.equal(state.activeClientId, undefined)
  assert.equal(state.accounts.length, 0)
  assert.deepEqual(state.pendingRegistration.quarantinedRefreshTokens, ['new-refresh'])
  assert.deepEqual(await svc.logout(), { ok: true, revocation: 'unconfirmed' })
  assert.deepEqual(revoked, ['new-refresh', 'new-refresh'])
})

test('logout after cancelling an exchange reports pending remote uncertainty', async t => {
  const s = store(), entered = deferred(), release = deferred(), revoking = deferred()
  let authUrl
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate, fetch: async (url) => {
    if (url === SIWC_TOKEN) {
      entered.resolve(); await release.promise
      return json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope: `openid ${direct}`, id_token: jwt(new URL(authUrl).searchParams.get('nonce')) })
    }
    if (url === SIWC_JWKS) return json({ keys: [key] })
    if (url === SIWC_REVOCATION) { revoking.resolve(); return new Response(null, { status: 200 }) }
    throw Error('unexpected request')
  } })
  t.after(async () => { release.resolve(); await svc.close() })
  authUrl = await launch((await svc.login()).authUrl)
  assert.equal((await callback(authUrl)).status, 200)
  await entered.promise
  await svc.cancelLogin()
  assert.deepEqual(await svc.logout(), { ok: true, revocation: 'unconfirmed' })
  release.resolve()
  await revoking.promise
  for (let i = 0; i < 100 && (await s.read()).pendingRegistration?.authorizationPending?.length; i++) await new Promise(resolve => setImmediate(resolve))
  const state = await s.read()
  assert.equal(state.activeClientId, undefined)
  assert.equal(state.accounts.length, 0)
  assert.equal(state.pendingRegistration.authorizationPending?.length ?? 0, 0)
})

test('late failed reauthorization revocation can be retried without signing out another account', async t => {
  const a = account(), b = { ...account('client-b'), refreshToken: 'original-b-refresh' }
  const s = store({ ...initial(), accounts: [a, b] })
  const entered = deferred(), release = deferred(), revoking = deferred(), revoked = []
  let authUrl, allowRevoke = false, stopped = false
  const svc = new SiwcService(s, { now: () => NOW, withAccountChange: gate, beforeSignOut: async () => { stopped = true }, fetch: async (url, init) => {
    if (url === SIWC_TOKEN) {
      entered.resolve(); await release.promise
      return json({ access_token: 'late-access', refresh_token: 'late-refresh', token_type: 'Bearer', expires_in: 3600,
        scope: direct, id_token: jwt(authUrl.searchParams.get('nonce'), { aud: b.clientId, sub: b.subject }) })
    }
    if (url === SIWC_JWKS) return json({ keys: [key] })
    assert.equal(url, SIWC_REVOCATION)
    revoked.push([init.body.get('client_id'), init.body.get('token')]); revoking.resolve()
    return new Response(null, { status: allowRevoke ? 200 : 400 })
  } })
  t.after(async () => { release.resolve(); await svc.close() })
  authUrl = new URL(await launch((await svc.login({ clientId: b.clientId })).authUrl))
  assert.equal((await callback(authUrl, null)).status, 200)
  await entered.promise
  await svc.cancelLogin()
  assert.equal((await svc.status()).pendingRevocation, true)
  assert.deepEqual(await svc.logout({ pendingOnly: true }), { ok: true, revocation: 'unconfirmed' })
  release.resolve()
  await revoking.promise
  for (let i = 0; i < 100 && (await s.read()).accounts[1].authorizationPending?.length; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await s.read()).accounts[1].quarantinedHistory[0].refreshToken, 'late-refresh')
  allowRevoke = true
  assert.deepEqual(await svc.logout({ pendingOnly: true }), { ok: true, revocation: 'confirmed' })
  assert.deepEqual(revoked, [[b.clientId, 'late-refresh'], [b.clientId, 'late-refresh']])
  assert.equal((await svc.status()).pendingRevocation, undefined)
  assert.equal((await s.read()).activeClientId, a.clientId)
  assert.equal((await s.read()).accounts[1].refreshToken, 'original-b-refresh')
  assert.equal((await s.read()).accounts[1].quarantinedHistory, undefined)
  assert.equal(stopped, false)
})

test('logout without an active account reports a saved reauthorization still exchanging', async t => {
  const a = { ...account(), refreshToken: undefined, accessToken: undefined, idToken: undefined, scopes: [] }
  const s = store({ hostId: 'host', accounts: [a], lastActiveClientId: a.clientId })
  const entered = deferred(), release = deferred()
  const svc = new SiwcService(s, { withAccountChange: gate, fetch: async (url) => {
    assert.equal(url, SIWC_TOKEN)
    entered.resolve(); await release.promise
    return json({ error: 'temporarily_unavailable' }, 503)
  } })
  t.after(async () => { release.resolve(); await svc.close() })
  const authUrl = new URL(await launch((await svc.login()).authUrl))
  assert.equal((await callback(authUrl, null)).status, 200)
  await entered.promise
  assert.deepEqual(await svc.logout(), { ok: true, revocation: 'unconfirmed' })
  assert.equal((await svc.status()).pendingRevocation, true)
})

test('ending an identity-only sign-in clears its ID token without claiming revocation', async () => {
  const a = { ...account(), accessToken: undefined, refreshToken: undefined, scopes: ['openid'] }
  const s = store({ ...initial(), accounts: [a] })
  let requests = 0
  const svc = new SiwcService(s, { withAccountChange: gate, fetch: async () => { requests++; throw Error('unexpected HTTP request') } })
  assert.equal((await svc.status()).planUsage, 'disabled')
  assert.deepEqual(await svc.logout(), { ok: true, revocation: 'not_applicable' })
  assert.equal((await svc.status()).authenticated, false)
  assert.equal((await s.read()).accounts[0].idToken, undefined)
  assert.equal((await s.read()).lastActiveClientId, a.clientId)
  assert.equal(requests, 0)
})
