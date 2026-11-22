import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { inspect } from 'node:util'
import test from 'node:test'
import { SiwcAuth as Auth, SiwcOAuthError, SIWC_AGENT_NAME, SIWC_AUTHORIZE, SIWC_DISCOVERY, SIWC_ISSUER, SIWC_JWKS, SIWC_RESOURCE, SIWC_TOKEN, SIWC_REVOCATION, verifyIdToken } from '../src/siwc-auth.ts'

class SiwcAuth extends Auth {
  constructor(options) {
    super(options.fetch ? { ...options, fetch: (url, init) => url === SIWC_DISCOVERY
      ? Promise.resolve(Response.json({ issuer: SIWC_ISSUER, revocation_endpoint: SIWC_REVOCATION })) : options.fetch(url, init) } : options)
  }
}

const now = 1_790_000_000_000
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }
function jwt(claims, header = { alg: 'RS256', kid: 'test-key' }) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const input = `${encode(header)}.${encode({ iss: 'https://auth.openai.com', sub: 'subject-1', aud: 'oaiapp_test', iat: now / 1000, exp: now / 1000 + 3600, ...claims })}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`
}
function memoryStore(initial) {
  let state = initial
  let pending = Promise.resolve()
  return {
    async read() { return structuredClone(state) },
    modify(update) {
      const run = pending.then(async () => { const next = await update(structuredClone(state)); if (next !== undefined) state = structuredClone(next) })
      pending = run.catch(() => {})
      return run
    },
  }
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }) }
const granted = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
function response(idToken, fields = {}) { return { access_token: 'access-new', refresh_token: 'refresh-new', id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: granted, ...fields } }
function state(account) { return { hostId: 'urn:uuid:host', accounts: [account] } }
function account(fields = {}) { return { clientId: 'oaiapp_test', issuer: 'https://auth.openai.com', subject: 'subject-1', email: 'test@example.com', idToken: 'id-old', accessToken: 'access-old', refreshToken: 'refresh-old', tokenType: 'Bearer', expiresAt: now + 1000, scopes: granted.split(' '), ...fields } }
function mockFetch(handleToken) {
  return async (url, options) => {
    if (url === SIWC_JWKS) return json({ keys: [jwk] })
    if (url === SIWC_TOKEN) return handleToken(new URLSearchParams(options.body))
    throw Error('unexpected network')
  }
}
async function authorize(attempt) {
  const result = await fetch(attempt.launchUrl, { redirect: 'manual' })
  assert.equal(result.status, 303)
  return new URL(result.headers.get('location'))
}
async function callback(attempt, params) {
  const url = new URL(attempt.redirectUri)
  for (const [key, value] of Object.entries(params)) url.searchParams.append(key, value)
  return fetch(url)
}

test('dynamic registration uses loopback, PKCE and issued client; validates and stores identity', async () => {
  const store = memoryStore()
  let exchanged = false
  let authParams
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async form => {
    exchanged = true
    assert.equal(form.get('client_id'), 'oaiapp_test')
    assert.equal(form.get('redirect_uri'), authParams.get('redirect_uri'))
    assert.equal(form.get('resource'), SIWC_RESOURCE)
    assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), authParams.get('code_challenge'))
    return json(response(jwt({ nonce: authParams.get('nonce'), email: 'test@example.com', email_verified: true })))
  }) })
  const attempt = await auth.startSignIn()
  const url = (await authorize(attempt))
  authParams = url.searchParams
  assert.equal(url.origin + url.pathname, SIWC_AUTHORIZE)
  assert.equal(authParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(authParams.get('agent_name_hint'), 'dsh-openai-oauth')
  assert.match(attempt.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
  assert.match(authParams.get('ext_agent_host_id'), /^urn:uuid:/)
  assert.equal((await callback(attempt, { state: 'wrong', code: 'code', client_id: 'oaiapp_test' })).status, 400)
  assert.equal(exchanged, false)
  assert.equal((await callback(attempt, { state: authParams.get('state'), code: 'code', client_id: 'oaiapp_test' })).status, 200)
  const result = await attempt.result
  assert.deepEqual(result, { clientId: 'oaiapp_test', subject: 'subject-1', email: 'test@example.com', emailVerified: true, signedIn: true, canUsePlan: true, expiresAt: now + 3600000 })
  assert.equal((await store.read()).accounts[0].refreshToken, 'refresh-new')
  assert.doesNotMatch(JSON.stringify(result), /access-new|refresh-new/)
})

test('state, authorization errors, missing client and cancellation stop exchange', async () => {
  let calls = 0
  const auth = new SiwcAuth({ store: memoryStore(), appName: SIWC_AGENT_NAME, fetch: mockFetch(async () => { calls++; return json({}) }) })
  let attempt = await auth.startSignIn()
  let params = (await authorize(attempt)).searchParams
  await callback(attempt, { state: params.get('state'), error: 'access_denied' })
  await assert.rejects(attempt.result, /authorization failed/)
  attempt = await auth.startSignIn()
  params = (await authorize(attempt)).searchParams
  await callback(attempt, { state: params.get('state'), code: 'code' })
  await assert.rejects(attempt.result, /issued client ID/)
  attempt = await auth.startSignIn()
  await attempt.cancel()
  await assert.rejects(attempt.result, /cancelled/)
  assert.equal(calls, 0)
})

test('returning sign-in preserves client, host and selected identity', async () => {
  const store = memoryStore(state(account()))
  let params
  let identity = 'other'
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json(response(jwt({ nonce: params.get('nonce'), sub: identity })))) })
  let attempt = await auth.startSignIn('oaiapp_test', 600000, true)
  params = (await authorize(attempt)).searchParams
  assert.equal(params.get('ext_agent_host_id'), 'urn:uuid:host')
  assert.equal(params.get('id_token_hint'), 'id-old')
  assert.equal(params.has('agent_name_hint'), false)
  await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_other' })
  await assert.rejects(attempt.result, /issued client ID/)
  attempt = await auth.startSignIn('oaiapp_test')
  params = (await authorize(attempt)).searchParams
  await callback(attempt, { state: params.get('state'), code: 'code' })
  await assert.rejects(attempt.result, /identity changed/)
  assert.equal((await store.read()).accounts[0].refreshToken, 'refresh-old')
  identity = 'subject-1'
  attempt = await auth.startSignIn('oaiapp_test')
  params = (await authorize(attempt)).searchParams
  await callback(attempt, { state: params.get('state'), code: 'code' })
  assert.equal((await attempt.result).subject, 'subject-1')
  attempt = await auth.startSignIn('oaiapp_test', 600000, false)
  assert.equal((await authorize(attempt)).searchParams.has('id_token_hint'), false)
  await attempt.cancel()
  await assert.rejects(attempt.result, /cancelled/)
})

test('OIDC verification rejects bad signature, algorithm, key, issuer, audience, time and nonce', async () => {
  const fetcher = mockFetch(() => { throw Error('unused') })
  const verify = token => verifyIdToken(token, 'oaiapp_test', 'nonce', fetcher, now)
  assert.equal((await verify(jwt({ nonce: 'nonce' }))).subject, 'subject-1')
  for (const claims of [{ iss: 'https://evil.example' }, { aud: 'other' }, { exp: now / 1000 }, { iat: now / 1000 + 100 }, { nbf: now / 1000 + 100 }, { nonce: 'wrong' }, { sub: '' }, { aud: ['oaiapp_test', 'other'] }]) {
    await assert.rejects(verify(jwt({ nonce: 'nonce', ...claims })))
  }
  await assert.rejects(verify(jwt({ nonce: 'nonce' }, { alg: 'none', kid: 'test-key' })))
  await assert.rejects(verify(jwt({ nonce: 'nonce' }, { alg: 'RS256', kid: 'unknown' })))
  const parts = jwt({ nonce: 'nonce' }).split('.')
  parts[2] = Buffer.alloc(256).toString('base64url')
  await assert.rejects(verify(parts.join('.')))
})

test('refresh serializes across instances and persists rotated tokens and scopes atomically', async () => {
  const store = memoryStore(state(account()))
  let calls = 0
  const fetcher = mockFetch(async form => {
    calls++
    assert.equal(form.get('grant_type'), 'refresh_token')
    assert.equal(form.get('refresh_token'), 'refresh-old')
    assert.equal(form.has('scope'), false)
    assert.equal(form.get('resource'), SIWC_RESOURCE)
    await new Promise(resolve => setTimeout(resolve, 20))
    return json(response(undefined, { id_token: undefined }))
  })
  const first = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: fetcher })
  const second = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: fetcher })
  assert.deepEqual(await Promise.all([first.accessToken('oaiapp_test'), second.accessToken('oaiapp_test')]), ['access-new', 'access-new'])
  assert.equal(calls, 1)
  const saved = (await store.read()).accounts[0]
  assert.equal(saved.refreshToken, 'refresh-new')
  assert.equal(saved.idToken, 'id-old')
  assert.equal(saved.expiresAt, now + 3600000)
})

test('never refreshes before earliest_refresh_at and preserves the grant across an expired access-token gap', async () => {
  for (const timestamp of [ms => ms / 1000, ms => new Date(ms).toISOString()]) {
    let clock = now, authNonce, refreshes = 0
    const s = memoryStore()
    const refreshAt = now + 110000
    const auth = new SiwcAuth({ store: s, appName: SIWC_AGENT_NAME, now: () => clock, fetch: mockFetch(async form => {
      if (form.get('grant_type') === 'refresh_token') {
        refreshes++
        assert.ok(clock >= refreshAt)
        assert.equal(form.get('refresh_token'), 'refresh-new')
        return json(response(undefined, { access_token: 'access-rotated', refresh_token: 'refresh-rotated', earliest_refresh_at: timestamp(clock + 3500000) }))
      }
      return json(response(jwt({ nonce: authNonce }), { expires_in: 100, earliest_refresh_at: timestamp(refreshAt) }))
    }) })
    const attempt = await auth.startSignIn()
    try {
      const authorization = (await authorize(attempt)).searchParams
      authNonce = authorization.get('nonce')
      await callback(attempt, { state: authorization.get('state'), client_id: 'oaiapp_test', code: 'test-code' })
      await attempt.result
      assert.equal((await s.read()).accounts[0].earliestRefreshAt, refreshAt)
      clock = now + 90000
      assert.equal(await auth.accessToken('oaiapp_test'), 'access-new')
      assert.equal(refreshes, 0)
      clock = now + 105000
      const before = await s.read()
      await assert.rejects(auth.accessToken('oaiapp_test'), { code: 'refresh_not_ready', status: 503, uncertain: false, reauthorizationRequired: false })
      assert.equal(refreshes, 0)
      assert.deepEqual(await s.read(), before)
      clock = refreshAt
      assert.equal(await auth.accessToken('oaiapp_test'), 'access-rotated')
      assert.equal(refreshes, 1)
      assert.equal((await s.read()).accounts[0].earliestRefreshAt, clock + 3500000)
    } finally { await attempt.cancel() }
  }
})

test('permission denial and failed refresh do not disclose tokens', async () => {
  const store = memoryStore(state(account({ scopes: ['openid'] })))
  let calls = 0
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => { calls++; return json({ error: 'secret-from-server' }, 400) }) })
  await assert.rejects(auth.accessToken('oaiapp_test'), /permission not granted/)
  assert.equal(calls, 0)
  await store.modify(async s => ({ ...s, accounts: [account()] }))
  await assert.rejects(auth.accessToken('oaiapp_test'), e => !e.message.includes('secret-from-server') && /400/.test(e.message))
  assert.equal((await store.read()).accounts[0].refreshToken, undefined)
})

test('scope reduction on refresh is saved before refusing inference', async () => {
  const store = memoryStore(state(account()))
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json(response(undefined, { id_token: undefined, scope: 'openid' }))) })
  await assert.rejects(auth.accessToken('oaiapp_test'), /permission not granted/)
  const saved = (await store.read()).accounts[0]
  assert.equal(saved.refreshToken, 'refresh-new')
  assert.deepEqual(saved.scopes, ['openid'])
})

test('sign-out revokes selected session, clears tokens and retains mapping and host', async () => {
  const other = account({ clientId: 'oaiapp_other', subject: 'other' })
  const store = memoryStore({ hostId: 'urn:uuid:host', accounts: [account(), other] })
  let requests = 0
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, fetch: async (url, options) => {
    assert.equal(url, SIWC_REVOCATION)
    const form = new URLSearchParams(options.body)
    assert.equal(form.get('token'), 'refresh-old')
    assert.equal(form.get('client_id'), 'oaiapp_test')
    requests++
    return new Response(null, { status: 200 })
  } })
  assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: true })
  const saved = await store.read()
  assert.equal(saved.hostId, 'urn:uuid:host')
  assert.equal(saved.accounts[0].subject, 'subject-1')
  assert.equal(saved.accounts[0].refreshToken, undefined)
  assert.equal(saved.accounts[1].refreshToken, 'refresh-old')
  assert.equal(requests, 1)
})

test('unconfirmed remote revocation clears tokens and reports failure', async () => {
  const store = memoryStore(state(account()))
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, fetch: async () => new Response(null, { status: 400 }) })
  assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: false })
  assert.equal((await store.read()).accounts[0].refreshToken, undefined)
})

test('uses verified OpenAI discovery for revocation and never sends a token to another origin', async () => {
  const endpoint = `${SIWC_ISSUER}/fixture/revoke`
  const s = memoryStore(state(account()))
  const sent = []
  const auth = new Auth({ store: s, appName: SIWC_AGENT_NAME, fetch: async (url, init) => {
    sent.push(url)
    assert.equal(init.redirect, 'error')
    if (url === SIWC_DISCOVERY) {
      assert.equal(init.body, undefined)
      return Response.json({ issuer: SIWC_ISSUER, revocation_endpoint: endpoint })
    }
    assert.equal(url, endpoint)
    assert.equal(init.method, 'POST')
    assert.equal(init.body.get('client_id'), 'oaiapp_test')
    assert.equal(init.body.get('token'), 'refresh-old')
    return new Response(null, { status: sent.length === 2 ? 503 : 200 })
  } })
  assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: true })
  assert.deepEqual(sent, [SIWC_DISCOVERY, endpoint, endpoint])

  const unsafe = memoryStore(state(account()))
  let requests = 0
  const invalid = new Auth({ store: unsafe, appName: SIWC_AGENT_NAME, fetch: async (url, init) => {
    requests++
    assert.equal(url, SIWC_DISCOVERY)
    assert.equal(init.body, undefined)
    return Response.json({ issuer: SIWC_ISSUER, revocation_endpoint: 'https://example.test/revoke' })
  } })
  assert.deepEqual(await invalid.signOut('oaiapp_test'), { revoked: false })
  assert.equal(requests, 3)
  assert.equal((await unsafe.read()).accounts[0].refreshToken, undefined)
})

test('rediscovers a stale revocation endpoint at most once on 404 or 410', async () => {
  for (const status of [404, 410]) {
    const a = account(), b = account({ clientId: 'oaiapp_b', refreshToken: 'b-refresh' })
    const s = memoryStore({ ...state(a), accounts: [a, b] })
    const previous = `${SIWC_ISSUER}/fixture/previous-revoke`, current = `${SIWC_ISSUER}/fixture/current-revoke`
    let moved = false
    const calls = []
    const auth = new Auth({ store: s, appName: SIWC_AGENT_NAME, fetch: async (url, init) => {
      const supplied = init.body?.get('token')
      calls.push([url, supplied])
      assert.equal(init.redirect, 'error')
      if (url === SIWC_DISCOVERY) return json({ issuer: SIWC_ISSUER, revocation_endpoint: moved ? current : previous })
      assert.equal(init.body.get('token_type_hint'), 'refresh_token')
      if (!moved) return new Response(null, { status: 200 })
      return new Response(null, { status: url === current && status === 404 ? 200 : status })
    } })
    assert.deepEqual(await auth.signOut(a.clientId), { revoked: true })
    moved = true
    assert.deepEqual(await auth.signOut(b.clientId), { revoked: status === 404 })
    assert.deepEqual(calls, [[SIWC_DISCOVERY, undefined], [previous, a.refreshToken], [previous, b.refreshToken], [SIWC_DISCOVERY, undefined], [current, b.refreshToken]])
    assert.equal((await s.read()).accounts[1].refreshToken, undefined)
  }
})

test('unfinished revocation never revokes a live token or a token undergoing refresh', async () => {
  for (const refreshPending of [false, true]) {
    const live = account({ refreshPending, refreshToken: refreshPending ? undefined : 'live-refresh',
      quarantined: refreshPending ? { refreshToken: 'live-refresh', scopes: [], reason: 'refresh_uncertain' } : undefined,
      quarantinedHistory: ['live-refresh', 'late-refresh'].map(refreshToken => ({ refreshToken, scopes: [], reason: 'authorization_unverified' })) })
    const s = memoryStore({ ...state(live), activeClientId: live.clientId })
    const calls = []
    const auth = new SiwcAuth({ store: s, appName: SIWC_AGENT_NAME, fetch: async (url, init) => {
      assert.equal(url, SIWC_REVOCATION)
      calls.push(init.body.get('token'))
      return new Response(null, { status: 200 })
    } })
    assert.deepEqual(await auth.retryRevocation(live.clientId), { revoked: true, hadSession: true })
    const saved = await s.read()
    assert.equal(saved.activeClientId, live.clientId)
    assert.deepEqual(saved.accounts[0].quarantined, live.quarantined)
    assert.equal(saved.accounts[0].refreshToken, live.refreshToken)
    assert.deepEqual(calls, ['late-refresh'])
  }
})

test('terminal refresh errors are structured; uncertain server errors fail closed', async () => {
  for (const code of ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']) {
    const store = memoryStore(state(account()))
    const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json({ error: code, error_description: 'must not leak' }, 400)) })
    await assert.rejects(auth.accessToken('oaiapp_test'), error => error instanceof SiwcOAuthError && error.code === code && error.reauthorizationRequired && !error.message.includes('must not leak'))
    const saved = (await store.read()).accounts[0]
    assert.equal(saved.subject, 'subject-1')
    assert.equal(saved.refreshToken, undefined)
    assert.equal(saved.idToken, undefined)
  }
  const store = memoryStore(state(account()))
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json({ error: 'server_error' }, 503)) })
  await assert.rejects(auth.accessToken('oaiapp_test'), error => error.code === 'server_error' && error.uncertain && !error.reauthorizationRequired)
  assert.equal((await store.read()).accounts[0].refreshToken, undefined)
  assert.equal((await store.read()).accounts[0].quarantined.refreshToken, 'refresh-old')
  assert.equal((await auth.signOut('oaiapp_test')).revoked, false)
})

test('invalid client is reported as configuration error without leaking or reusing refresh token', async () => {
  const store = memoryStore(state(account()))
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json({ error: 'invalid_client' }, 401)) })
  await assert.rejects(auth.accessToken('oaiapp_test'), error => error instanceof SiwcOAuthError && error.code === 'invalid_client' && !error.reauthorizationRequired)
  assert.equal((await store.read()).accounts[0].refreshToken, undefined)
  assert.equal((await store.read()).accounts[0].quarantined.refreshToken, 'refresh-old')
  assert.equal((await auth.signOut('oaiapp_test')).revoked, false)
})

test('ambiguous network failure or invalid rotated identity cannot retry old refresh token', async () => {
  for (const mode of ['network', 'jwks', 'identity']) {
    const store = memoryStore(state(account()))
    let calls = 0
    const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: async url => {
      if (url === SIWC_TOKEN) { calls++; if (mode === 'network') throw Error('secret'); return json(response(jwt({ sub: mode === 'identity' ? 'wrong' : 'subject-1' }))) }
      if (url === SIWC_JWKS && mode === 'identity') return json({ keys: [jwk] })
      throw Error('JWKS unavailable')
    } })
    await assert.rejects(auth.accessToken('oaiapp_test'), error => error instanceof SiwcOAuthError && error.uncertain)
    assert.equal((await store.read()).accounts[0].refreshToken, undefined)
    assert.equal((await store.read()).accounts[0].quarantined.refreshToken, mode === 'network' ? 'refresh-old' : 'refresh-new')
    await assert.rejects(auth.accessToken('oaiapp_test'), error => error instanceof SiwcOAuthError && error.uncertain)
    assert.equal(calls, 1)
  }
})

test('durable refresh tombstone prevents old-token reuse when final commit fails', async () => {
  const base = memoryStore(state(account()))
  let writes = 0
  const store = { read: base.read, async modify(update) { writes++; if (writes === 2) { await update(await base.read()); throw Error('disk failure') } return base.modify(update) } }
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json(response(undefined, { id_token: undefined }))) })
  await assert.rejects(auth.accessToken('oaiapp_test'), /disk failure/)
  const saved = (await store.read()).accounts[0]
  assert.equal(saved.refreshPending, true)
  assert.equal(saved.refreshToken, undefined)
  assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: false })
  await assert.rejects(auth.accessToken('oaiapp_test'), /signed out/)
})

test('in-flight sign-in cannot restore credentials after sign-out or cancellation', async () => {
  for (const mode of ['signout', 'cancel']) {
    const store = memoryStore(state(account()))
    let release, began
    const started = new Promise(resolve => { began = resolve })
    const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: async (url) => {
      if (url === SIWC_TOKEN) { began(); await new Promise(resolve => { release = resolve }); return json(response(jwt({ nonce }))) }
      if (url === SIWC_JWKS) return json({ keys: [jwk] })
      if (url === SIWC_REVOCATION) return new Response(null, { status: 200 })
      throw Error('unexpected')
    } })
    const attempt = await auth.startSignIn('oaiapp_test')
    const params = (await authorize(attempt)).searchParams
    const nonce = params.get('nonce')
    await callback(attempt, { state: params.get('state'), code: 'code' })
    await started
    if (mode === 'signout') await auth.signOut('oaiapp_test'); else await attempt.cancel()
    release()
    await assert.rejects(attempt.result, mode === 'cancel' ? /cancelled/ : /superseded/)
    assert.notEqual((await store.read()).accounts[0].refreshToken, 'refresh-new')
  }
})

test('sign-out during code exchange does not falsely confirm revocation', async () => {
  const store = memoryStore(state(account()))
  let release, entered, nonce
  const exchangeEntered = new Promise(resolve => { entered = resolve })
  const allowExchange = new Promise(resolve => { release = resolve })
  const revoked = []
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: async (url, init) => {
    if (url === SIWC_TOKEN) { entered(); await allowExchange; return json(response(jwt({ nonce }), { refresh_token: 'issued-after-signout' })) }
    if (url === SIWC_JWKS) return json({ keys: [jwk] })
    if (url === SIWC_REVOCATION) { revoked.push(init.body.get('token')); return new Response(null, { status: 200 }) }
    throw Error('unexpected endpoint')
  } })
  const login = await auth.startSignIn('oaiapp_test')
  const params = (await authorize(login)).searchParams
  nonce = params.get('nonce')
  await callback(login, { state: params.get('state'), code: 'code' })
  await exchangeEntered
  assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: false })
  release()
  await assert.rejects(login.result, /superseded/)
  assert.deepEqual(revoked, ['refresh-old', 'issued-after-signout'])
  assert.equal((await store.read()).accounts[0].refreshToken, undefined)
})

test('a refresh during sign-in does not supersede authorization', async () => {
  const store = memoryStore(state(account()))
  let nonce
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async form => form.get('grant_type') === 'refresh_token' ? json(response(undefined, { id_token: undefined })) : json(response(jwt({ nonce })))) })
  const attempt = await auth.startSignIn('oaiapp_test')
  const params = (await authorize(attempt)).searchParams
  nonce = params.get('nonce')
  assert.equal(await auth.accessToken('oaiapp_test'), 'access-new')
  await callback(attempt, { state: params.get('state'), code: 'code' })
  assert.equal((await attempt.result).subject, 'subject-1')
})

test('malformed refresh response still quarantines returned replacement token', async () => {
  const store = memoryStore(state(account()))
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json({ refresh_token: 'raw-replacement', token_type: 'invalid' })) })
  await assert.rejects(auth.accessToken('oaiapp_test'), error => error.uncertain)
  assert.equal((await store.read()).accounts[0].quarantined.refreshToken, 'raw-replacement')
})

test('invalid rotated identity retains replacement for revocation', async () => {
  const store = memoryStore(state(account()))
  const revoked = []
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: async (url, init) => {
    if (url === SIWC_TOKEN) return json(response(jwt({ sub: 'different-subject' }), { refresh_token: 'replacement-to-revoke' }))
    if (url === SIWC_JWKS) return json({ keys: [jwk] })
    if (url === SIWC_REVOCATION) { revoked.push(init.body.get('token')); return new Response(null, { status: 200 }) }
    throw Error('unexpected endpoint')
  } })
  await assert.rejects(auth.accessToken('oaiapp_test'), error => error.uncertain)
  assert.equal((await store.read()).accounts[0].quarantined.refreshToken, 'replacement-to-revoke')
  assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: false })
  assert.deepEqual(revoked, ['replacement-to-revoke'])
})

test('fresh login keeps historical quarantine separate and its new refresh is usable', async () => {
  const store = memoryStore(state(account()))
  let nonce, refreshCalls = 0
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async form => {
    if (form.get('grant_type') === 'refresh_token') {
      if (++refreshCalls === 1) throw Error('network ambiguity')
      assert.equal(form.get('refresh_token'), 'refresh-login')
      return json(response(undefined, { id_token: undefined, refresh_token: 'refresh-latest' }))
    }
    return json(response(jwt({ nonce }), { expires_in: 1, refresh_token: 'refresh-login' }))
  }) })
  await assert.rejects(auth.accessToken('oaiapp_test'), error => error.uncertain)
  const login = await auth.startSignIn('oaiapp_test')
  const params = (await authorize(login)).searchParams
  nonce = params.get('nonce')
  await callback(login, { state: params.get('state'), code: 'code' })
  await login.result
  assert.equal((await store.read()).accounts[0].quarantinedHistory[0].refreshToken, 'refresh-old')
  assert.equal(await auth.accessToken('oaiapp_test'), 'access-new')
  assert.equal((await store.read()).accounts[0].refreshToken, 'refresh-latest')
  assert.equal((await store.read()).accounts[0].quarantinedHistory[0].refreshToken, 'refresh-old')
})

test('a newer sign-in supersedes an older attempt', async () => {
  const store = memoryStore(state(account()))
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json(response(jwt({ nonce: oldNonce })))) })
  const old = await auth.startSignIn('oaiapp_test')
  const oldParams = (await authorize(old)).searchParams
  const oldNonce = oldParams.get('nonce')
  const newer = await auth.startSignIn('oaiapp_test')
  await callback(old, { state: oldParams.get('state'), code: 'code' })
  await assert.rejects(old.result, /superseded/)
  await newer.cancel()
})

test('invalid dynamic code keeps client only as unverified registration for retry', async () => {
  const store = memoryStore()
  let attemptNumber = 0, nonce
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async form => {
    assert.equal(form.get('client_id'), 'oaiapp_test')
    return ++attemptNumber === 1 ? json({ error: 'invalid_grant' }, 400) : json(response(jwt({ nonce })))
  }) })
  let attempt = await auth.startSignIn()
  let params = (await authorize(attempt)).searchParams
  await callback(attempt, { state: params.get('state'), code: 'stale', client_id: 'oaiapp_test' })
  await assert.rejects(attempt.result, error => error instanceof SiwcOAuthError && error.code === 'invalid_grant')
  assert.equal((await store.read()).accounts.length, 0)
  assert.equal((await store.read()).pendingRegistration.clientId, 'oaiapp_test')
  assert.notEqual((await store.read()).pendingRegistration.revocationUnconfirmed, true)
  attempt = await auth.startSignIn(undefined, 600000, false, { retryRegistration: true })
  params = (await authorize(attempt)).searchParams
  nonce = params.get('nonce')
  assert.equal(params.get('client_id'), 'oaiapp_test')
  assert.equal(params.has('agent_name_hint'), false)
  await callback(attempt, { state: params.get('state'), code: 'fresh' })
  assert.equal((await attempt.result).subject, 'subject-1')
  assert.equal((await store.read()).pendingRegistration, undefined)
})

test('failed dynamic registration keeps unverified replacement private for retry', async () => {
  const store = memoryStore()
  let nonce
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: async url => {
    if (url === SIWC_TOKEN) return json(response(jwt({ nonce, sub: 'subject-1' }), { refresh_token: 'unverified-dynamic' }))
    throw Error('JWKS and revoke unavailable')
  } })
  const login = await auth.startSignIn()
  const params = (await authorize(login)).searchParams
  nonce = params.get('nonce')
  await callback(login, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
  await assert.rejects(login.result, /JWKS/)
  const pending = (await store.read()).pendingRegistration
  assert.equal(pending.clientId, 'oaiapp_test')
  assert.deepEqual(pending.quarantinedRefreshTokens, ['unverified-dynamic'])
  assert.equal(pending.revocationUnconfirmed, undefined)
  assert.deepEqual(await auth.listAccounts(), [])
  const retry = await auth.startSignIn(undefined, undefined, false, { retryRegistration: true })
  assert.equal((await authorize(retry)).searchParams.get('client_id'), 'oaiapp_test')
  await retry.cancel()
  assert.deepEqual((await store.read()).pendingRegistration.quarantinedRefreshTokens, ['unverified-dynamic'])
})

test('sign-out between refresh tombstone and network reports unconfirmed revocation', async () => {
  const base = memoryStore(state(account()))
  let entered, resume
  const atGap = new Promise(resolve => { entered = resolve })
  const continueRefresh = new Promise(resolve => { resume = resolve })
  let modifications = 0, tokenCalls = 0
  const store = { read: base.read, async modify(update) {
    modifications++
    const result = await base.modify(update)
    if (modifications === 1) { entered(); await continueRefresh }
    return result
  } }
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: async url => { if (url === SIWC_REVOCATION) return new Response(null, { status: 200 }); tokenCalls++; throw Error('unexpected') } })
  const refresh = auth.accessToken('oaiapp_test')
  await atGap
  assert.equal((await auth.listAccounts())[0].canUsePlan, false)
  assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: false })
  resume()
  await assert.rejects(refresh, /superseded/)
  assert.equal(tokenCalls, 0)
})

test('refresh keeps uncertainty added between its two transactions', async () => {
  const base = memoryStore(state(account()))
  let entered, resume
  const atGap = new Promise(resolve => { entered = resolve })
  const proceed = new Promise(resolve => { resume = resolve })
  let first = true
  const store = { read: base.read, async modify(update) {
    const result = await base.modify(update)
    if (first) { first = false; entered(); await proceed }
    return result
  } }
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json(response(undefined, { id_token: undefined }))) })
  const refresh = auth.accessToken('oaiapp_test')
  await atGap
  await base.modify(async current => ({ ...current, accounts: current.accounts.map(a => ({ ...a, refreshPriorUnconfirmed: true, quarantinedHistory: [{ refreshToken: 'concurrent-session', scopes: [], reason: 'authorization_unverified' }] })) }))
  resume()
  await refresh
  const saved = (await store.read()).accounts[0]
  assert.equal(saved.revocationUnconfirmed, true)
  assert.equal(saved.quarantinedHistory[0].refreshToken, 'concurrent-session')
})

test('refresh preserves concurrent unconfirmed authorization history', async () => {
  const store = memoryStore(state(account({ revocationUnconfirmed: true, quarantinedHistory: [{ refreshToken: 'lost-session', scopes: [], reason: 'authorization_unverified' }] })))
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: mockFetch(async () => json(response(undefined, { id_token: undefined }))) })
  await auth.accessToken('oaiapp_test')
  const saved = (await store.read()).accounts[0]
  assert.equal(saved.revocationUnconfirmed, true)
  assert.equal(saved.quarantinedHistory[0].refreshToken, 'lost-session')
})

test('cancelled sign-in between refresh phases does not prevent refresh', async () => {
  const base = memoryStore(state(account()))
  let entered, resume
  const atGap = new Promise(resolve => { entered = resolve })
  const proceed = new Promise(resolve => { resume = resolve })
  let first = true, tokenCalls = 0
  const store = { read: base.read, async modify(update) {
    const result = await base.modify(update)
    if (first) { first = false; entered(); await proceed }
    return result
  } }
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: async url => { assert.equal(url, SIWC_TOKEN); tokenCalls++; return json(response(undefined, { id_token: undefined })) } })
  const refresh = auth.accessToken('oaiapp_test')
  await atGap
  const login = await auth.startSignIn('oaiapp_test')
  await login.cancel()
  resume()
  assert.equal(await refresh, 'access-new')
  assert.equal(tokenCalls, 1)
})

test('consent is only sent when explicitly requested; access_denied is structured', async () => {
  const auth = new SiwcAuth({ store: memoryStore(state(account())), appName: SIWC_AGENT_NAME })
  let attempt = await auth.startSignIn('oaiapp_test')
  assert.equal((await authorize(attempt)).searchParams.has('prompt'), false)
  await attempt.cancel()
  attempt = await auth.startSignIn('oaiapp_test', 600000, false, { promptConsent: true })
  const params = (await authorize(attempt)).searchParams
  assert.equal(params.get('prompt'), 'consent')
  await callback(attempt, { state: params.get('state'), error: 'access_denied' })
  await assert.rejects(attempt.result, error => error instanceof SiwcOAuthError && error.code === 'access_denied')
})


test('loopback launch is one use and keeps ID-token and login hints out of serialized attempts', async () => {
  const secret = 'id-token-secret-value'
  const store = memoryStore(state(account({ idToken: secret, email: 'private@example.com' })))
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME })
  const attempt = await auth.startSignIn('oaiapp_test', 600000, true)
  assert.equal('authorizationUrl' in attempt, false)
  for (const value of [JSON.stringify(attempt), inspect(attempt), attempt.launchUrl]) {
    assert.doesNotMatch(value, /id-token-secret-value|private@example\.com|id_token_hint|login_hint/)
  }
  const redirect = await fetch(attempt.launchUrl, { redirect: 'manual' })
  assert.equal(redirect.status, 303)
  assert.equal(redirect.headers.get('cache-control'), 'no-store')
  assert.equal(redirect.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(redirect.headers.get('access-control-allow-origin'), null)
  const location = new URL(redirect.headers.get('location'))
  assert.equal(location.origin + location.pathname, SIWC_AUTHORIZE)
  assert.equal(location.searchParams.get('id_token_hint'), secret)
  assert.equal(location.searchParams.get('login_hint'), 'private@example.com')
  assert.equal(location.searchParams.get('client_id'), 'oaiapp_test')
  assert.equal(location.searchParams.get('ext_agent_host_id'), 'urn:uuid:host')
  const replay = await fetch(attempt.launchUrl, { redirect: 'manual' })
  assert.equal(replay.status, 410)
  assert.doesNotMatch(await replay.text(), /id-token-secret-value|private@example\.com/)
  await attempt.cancel()
  await assert.rejects(attempt.result, /cancelled/)
})

test('duplicate or wrong state cannot consume an attempt and expiry blocks exchange', async () => {
  let clock = now, calls = 0
  const store = memoryStore()
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => clock, fetch: mockFetch(async () => { calls++; return json({}) }) })
  const attempt = await auth.startSignIn(undefined, 60000)
  const params = (await authorize(attempt)).searchParams
  const url = new URL(attempt.redirectUri)
  url.searchParams.append('state', params.get('state'))
  url.searchParams.append('state', params.get('state'))
  url.searchParams.append('code', 'code')
  url.searchParams.append('client_id', 'oaiapp_test')
  assert.equal((await fetch(url)).status, 400)
  assert.equal((await callback(attempt, { state: 'bad', code: 'code', client_id: 'oaiapp_test' })).status, 400)
  clock += 60000
  assert.equal((await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })).status, 400)
  await assert.rejects(attempt.result, /timed out/)
  assert.equal(calls, 0)
  assert.equal((await store.read()).pendingRegistration, undefined)
})

test('sign-in activation is atomic when no account is active and preserves an existing selection', async () => {
  for (const mode of ['first', 'returning', 'additional', 'last-active', 'already-active']) {
    const initial = { hostId: 'urn:uuid:host', accounts: mode === 'first' || mode === 'last-active' ? [] : mode === 'returning' ? [account(), account({ clientId: 'oaiapp_old', subject: 'subject-2' })] : [account()],
      subjectStates: [{ subject: 'subject-1', planUsed: true }],
      ...(mode === 'last-active' || mode === 'returning' ? { lastActiveClientId: 'oaiapp_old' } : {}),
      ...(mode === 'already-active' ? { activeClientId: 'oaiapp_test' } : {}) }
    const base = memoryStore(initial), writes = []
    const store = { read: base.read, modify: update => base.modify(async current => {
      const next = await update(current)
      if (next) writes.push(structuredClone(next))
      return next
    }) }
    let nonce, gateCalls = 0, insideGate = false
    const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: true,
      commitSignIn: async commit => { gateCalls++; insideGate = true; try { return await commit() } finally { insideGate = false } },
      fetch: mockFetch(async () => { assert.equal(insideGate, false); return json(response(jwt({ aud: mode === 'returning' ? 'oaiapp_test' : 'oaiapp_new', nonce }))) }) })
    const attempt = await auth.startSignIn(mode === 'returning' ? 'oaiapp_test' : undefined)
    const params = (await authorize(attempt)).searchParams
    nonce = params.get('nonce')
    const clientId = mode === 'returning' ? 'oaiapp_test' : 'oaiapp_new'
    await callback(attempt, { state: params.get('state'), code: 'code', client_id: clientId })
    await attempt.result
    assert.equal(gateCalls, 1)
    const saved = await store.read()
    assert.equal(saved.activeClientId, mode === 'already-active' ? 'oaiapp_test' : clientId, mode)
    assert.deepEqual(saved.subjectStates, initial.subjectStates)
    const committed = writes.find(item => item.accounts.some(a => a.clientId === clientId && a.refreshToken === 'refresh-new'))
    assert.ok(committed)
    assert.equal(committed.activeClientId, saved.activeClientId, mode)
  }
})

test('rejected commit gate stores no verified account and revokes issued credentials', async () => {
  const store = memoryStore(), revocations = []
  let nonce
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: true,
    commitSignIn: async () => { throw Error('turn gate busy') },
    fetch: async (url, init) => {
      if (url === SIWC_TOKEN) return json(response(jwt({ nonce })))
      if (url === SIWC_JWKS) return json({ keys: [jwk] })
      if (url === SIWC_REVOCATION) { revocations.push(init.body.get('token')); return new Response(null, { status: 200 }) }
      throw Error('unexpected endpoint')
    } })
  const attempt = await auth.startSignIn()
  const params = (await authorize(attempt)).searchParams
  nonce = params.get('nonce')
  await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
  await assert.rejects(attempt.result, /turn gate busy/)
  const saved = await store.read()
  assert.deepEqual(saved.accounts, [])
  assert.equal(saved.activeClientId, undefined)
  assert.equal(saved.pendingRegistration.clientId, 'oaiapp_test')
  assert.deepEqual(revocations, ['refresh-new'])
})

test('concurrent dynamic registrations are blocked until cancelled or expired', async () => {
  let clock = now
  const store = memoryStore()
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => clock })
  const first = await auth.startSignIn(undefined, 60000)
  await assert.rejects(auth.startSignIn(), /resolve pending registration/)
  await first.cancel()
  await assert.rejects(first.result, /cancelled/)
  const stale = await auth.startSignIn(undefined, 60000)
  const staleParams = (await authorize(stale)).searchParams
  clock += 60001
  const replacement = await auth.startSignIn()
  assert.equal((await callback(stale, { state: staleParams.get('state'), code: 'code', client_id: 'oaiapp_old' })).status, 400)
  await assert.rejects(stale.result, /timed out/)
  assert.equal((await store.read()).pendingRegistration.generation !== undefined, true)
  await replacement.cancel()
  await assert.rejects(replacement.result, /cancelled/)
  assert.equal((await store.read()).pendingRegistration, undefined)
})

test('timeout during exchange preserves issued registration and revokes a late token', async () => {
  const base = memoryStore()
  let exchangeStarted = false, entered, release, cleanup
  const started = new Promise(resolve => { entered = resolve })
  const proceed = new Promise(resolve => { release = resolve })
  const cleaned = new Promise(resolve => { cleanup = resolve })
  const store = { read: base.read, modify: update => base.modify(async current => {
    const next = await update(current)
    if (exchangeStarted && next?.pendingRegistration?.clientId && !next.pendingRegistration.authorizationPending?.length) cleanup()
    return next
  }) }
  const revoked = []
  let nonce
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, fetch: async (url, init) => {
    if (url === SIWC_TOKEN) { exchangeStarted = true; entered(); await proceed; return json(response(jwt({ nonce }))) }
    if (url === SIWC_JWKS) return json({ keys: [jwk] })
    if (url === SIWC_REVOCATION) { revoked.push(init.body.get('token')); return new Response(null, { status: 200 }) }
    throw Error('unexpected endpoint')
  } })
  const attempt = await auth.startSignIn(undefined, 1000)
  const params = (await authorize(attempt)).searchParams
  nonce = params.get('nonce')
  await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
  await started
  await assert.rejects(attempt.result, /timed out/)
  assert.equal((await store.read()).pendingRegistration.clientId, 'oaiapp_test')
  assert.deepEqual(await auth.signOutPending(), { revoked: false, hadSession: true })
  release()
  await cleaned
  await base.modify(async () => undefined)
  assert.deepEqual(revoked, ['refresh-new'])
  const saved = await store.read()
  assert.equal(saved.accounts.length, 0)
  assert.equal(saved.pendingRegistration.clientId, 'oaiapp_test')
  assert.equal(saved.pendingRegistration.authorizationPending.length, 0)
  const retry = await auth.startSignIn(undefined, 60000, false, { retryRegistration: true })
  const retryParams = (await authorize(retry)).searchParams
  assert.equal(retryParams.get('client_id'), 'oaiapp_test')
  assert.equal(retryParams.get('ext_agent_host_id'), saved.hostId)
  await retry.cancel()
})

test('pending sign-out reports real remote result and can retry known failed tokens', async () => {
  const store = memoryStore({ hostId: 'urn:uuid:host', accounts: [], pendingRegistration: { generation: 'g', clientId: 'oaiapp_test', quarantinedRefreshTokens: ['secret-a', 'secret-a', 'secret-b'] } })
  let allow = false
  const sent = []
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, fetch: async (url, init) => {
    assert.equal(url, SIWC_REVOCATION)
    assert.equal(init.body.get('client_id'), 'oaiapp_test')
    sent.push(init.body.get('token'))
    return new Response(null, { status: allow ? 200 : 400 })
  } })
  assert.deepEqual(await auth.signOutPending(), { revoked: false, hadSession: true })
  assert.deepEqual(sent, ['secret-a', 'secret-b'])
  assert.deepEqual((await store.read()).pendingRegistration.quarantinedRefreshTokens, ['secret-a', 'secret-b'])
  allow = true
  assert.deepEqual(await auth.signOutPending(), { revoked: true, hadSession: true })
  assert.deepEqual(sent, ['secret-a', 'secret-b', 'secret-a', 'secret-b'])
  const pending = (await store.read()).pendingRegistration
  assert.equal(pending.clientId, 'oaiapp_test')
  assert.equal(pending.quarantinedRefreshTokens, undefined)
  assert.deepEqual(await auth.signOutPending(), { revoked: false, hadSession: false })
  await store.modify(async current => ({ ...current, pendingRegistration: { ...current.pendingRegistration, revocationUnconfirmed: true, quarantinedRefreshTokens: ['secret-c'] } }))
  assert.deepEqual(await auth.signOutPending(), { revoked: false, hadSession: true })
})

test('cancel cannot claim failure after the credential commit has linearized', async () => {
  const base = memoryStore()
  let entered, release, nonce
  const atCommit = new Promise(resolve => { entered = resolve })
  const proceed = new Promise(resolve => { release = resolve })
  const store = { read: base.read, modify: update => base.modify(async current => {
    const next = await update(current)
    if (next?.activeClientId === 'oaiapp_test' && next.accounts.some(a => a.refreshToken === 'refresh-new')) { entered(); await proceed }
    return next
  }) }
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: true,
    fetch: mockFetch(async () => json(response(jwt({ nonce })))) })
  const attempt = await auth.startSignIn()
  const params = (await authorize(attempt)).searchParams
  nonce = params.get('nonce')
  await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
  await atCommit
  let cancelled = false
  const cancellation = attempt.cancel().then(() => { cancelled = true })
  await Promise.resolve()
  assert.equal(cancelled, false)
  release()
  await cancellation
  assert.equal((await attempt.result).clientId, 'oaiapp_test')
  const saved = await store.read()
  assert.equal(saved.activeClientId, 'oaiapp_test')
  assert.equal(saved.accounts[0].refreshToken, 'refresh-new')
})


test('ID-token verification ignores untrusted key URLs and rejects ambiguous or weak keys', async () => {
  const requests = []
  const fetcher = async (url, init) => { requests.push([url, init.redirect]); return json({ keys: [jwk] }) }
  const token = jwt({ nonce: 'nonce' }, { alg: 'RS256', kid: 'test-key', jku: 'https://evil.example/keys', x5u: 'https://evil.example/cert' })
  assert.equal((await verifyIdToken(token, 'oaiapp_test', 'nonce', fetcher, now)).subject, 'subject-1')
  assert.deepEqual(requests, [[SIWC_JWKS, 'error']])
  await assert.rejects(verifyIdToken(jwt({ nonce: 'nonce' }, { alg: 'RS256', kid: 'test-key', crit: ['jku'] }), 'oaiapp_test', 'nonce', fetcher, now), /header/)
  await assert.rejects(verifyIdToken(jwt({ nonce: 'nonce' }), 'oaiapp_test', 'nonce', async () => json({ keys: [jwk, jwk] }), now), /ambiguous/)
  const weak = generateKeyPairSync('rsa', { modulusLength: 1024 })
  const weakJwk = { ...weak.publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }
  await assert.rejects(verifyIdToken(jwt({ nonce: 'nonce' }), 'oaiapp_test', 'nonce', async () => json({ keys: [weakJwk] }), now))
  assert.equal((await verifyIdToken(jwt({ nonce: 'nonce', aud: ['oaiapp_test', 'other'], azp: 'oaiapp_test' }), 'oaiapp_test', 'nonce', fetcher, now)).subject, 'subject-1')
})

test('post-commit gate or store failure never revokes the live committed token', async () => {
  for (const mode of ['gate', 'store']) {
    const base = memoryStore()
    const store = { read: base.read, async modify(update) {
      let wasCommit = false
      await base.modify(async current => {
        const next = await update(current)
        wasCommit = !!next?.accounts.some(a => a.refreshToken === 'refresh-new')
        return next
      })
      if (mode === 'store' && wasCommit) throw Error('write reported failure after persistence')
    } }
    let nonce, revokes = 0
    const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: true,
      commitSignIn: async commit => { await commit(); if (mode === 'gate') throw Error('gate teardown failed') },
      fetch: async (url) => {
        if (url === SIWC_TOKEN) return json(response(jwt({ nonce })))
        if (url === SIWC_JWKS) return json({ keys: [jwk] })
        if (url === SIWC_REVOCATION) { revokes++; return new Response(null, { status: 200 }) }
        throw Error('unexpected endpoint')
      } })
    const attempt = await auth.startSignIn()
    const params = (await authorize(attempt)).searchParams
    nonce = params.get('nonce')
    await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
    assert.equal((await attempt.result).signedIn, true)
    assert.equal((await store.read()).activeClientId, 'oaiapp_test')
    assert.equal(revokes, 0)
  }
})

test('a gate that never commits cannot claim a successful sign-in', async () => {
  const store = memoryStore()
  let nonce, revokes = 0
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: true,
    commitSignIn: async () => {},
    fetch: async url => {
      if (url === SIWC_TOKEN) return json(response(jwt({ nonce })))
      if (url === SIWC_JWKS) return json({ keys: [jwk] })
      if (url === SIWC_REVOCATION) { revokes++; return new Response(null, { status: 200 }) }
      throw Error('unexpected endpoint')
    } })
  const attempt = await auth.startSignIn()
  const params = (await authorize(attempt)).searchParams
  nonce = params.get('nonce')
  await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
  await assert.rejects(attempt.result, /commit not performed/)
  assert.equal(revokes, 1)
  assert.deepEqual((await store.read()).accounts, [])
})


test('logout followed by re-login restores the previously selected account under the commit gate', async () => {
  const base = memoryStore({ hostId: 'urn:uuid:host', accounts: [account()], activeClientId: 'oaiapp_test', subjectStates: [{ subject: 'subject-1', planUsed: true }] })
  let insideGate = false, nonce, gateCalls = 0, revokeCalls = 0
  const store = { read: base.read, modify: update => base.modify(async current => {
    const next = await update(current)
    if (next?.accounts.some(a => a.refreshToken === 'refresh-new')) assert.equal(insideGate, true)
    return next
  }) }
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: true,
    commitSignIn: async commit => { gateCalls++; insideGate = true; try { return await commit() } finally { insideGate = false } },
    fetch: async (url, init) => {
      if (url === SIWC_REVOCATION) { revokeCalls++; assert.equal(init.body.get('token'), 'refresh-old'); return new Response(null, { status: 200 }) }
      if (url === SIWC_TOKEN) { assert.equal(init.body.get('client_id'), 'oaiapp_test'); return json(response(jwt({ nonce }))) }
      if (url === SIWC_JWKS) return json({ keys: [jwk] })
      throw Error('unexpected endpoint')
    } })
  assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: true })
  // The service's logout transaction clears the active selection but remembers it.
  await store.modify(async current => ({ ...current, lastActiveClientId: current.activeClientId, activeClientId: undefined }))
  const signedOut = await store.read()
  assert.equal(signedOut.activeClientId, undefined)
  assert.equal(signedOut.lastActiveClientId, 'oaiapp_test')
  const attempt = await auth.startSignIn(signedOut.lastActiveClientId)
  const params = (await authorize(attempt)).searchParams
  nonce = params.get('nonce')
  assert.equal(params.get('client_id'), 'oaiapp_test')
  assert.equal(params.get('ext_agent_host_id'), 'urn:uuid:host')
  await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
  await attempt.result
  const saved = await store.read()
  assert.equal(saved.activeClientId, 'oaiapp_test')
  assert.equal(saved.accounts[0].refreshToken, 'refresh-new')
  assert.deepEqual(saved.subjectStates, [{ subject: 'subject-1', planUsed: true }])
  assert.equal(gateCalls, 1)
  assert.equal(revokeCalls, 1)
})

test('re-login preserves a concurrent selection and respects disabled activation', async () => {
  for (const mode of ['other-active', 'last-active-changed', 'auto-activation-disabled']) {
    const store = memoryStore({ hostId: 'urn:uuid:host', accounts: [account({ accessToken: undefined, refreshToken: undefined }), account({ clientId: 'oaiapp_other', subject: 'subject-2' })], lastActiveClientId: 'oaiapp_test' })
    let nonce, entered, release, gateCalls = 0
    const started = new Promise(resolve => { entered = resolve })
    const proceed = new Promise(resolve => { release = resolve })
    const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: mode !== 'auto-activation-disabled',
      commitSignIn: async commit => { gateCalls++; return commit() },
      fetch: async url => {
        if (url === SIWC_TOKEN) { entered(); await proceed; return json(response(jwt({ nonce }))) }
        if (url === SIWC_JWKS) return json({ keys: [jwk] })
        throw Error('unexpected endpoint')
      } })
    const attempt = await auth.startSignIn('oaiapp_test')
    const params = (await authorize(attempt)).searchParams
    nonce = params.get('nonce')
    await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
    await started
    if (mode === 'other-active') await store.modify(async current => ({ ...current, activeClientId: 'oaiapp_other' }))
    if (mode === 'last-active-changed') await store.modify(async current => ({ ...current, lastActiveClientId: 'oaiapp_other' }))
    release()
    await attempt.result
    const saved = await store.read()
    assert.equal(saved.activeClientId, mode === 'other-active' ? 'oaiapp_other' : mode === 'last-active-changed' ? 'oaiapp_test' : undefined, mode)
    assert.equal(saved.accounts.find(a => a.clientId === 'oaiapp_test').refreshToken, 'refresh-new')
    assert.equal(gateCalls, 1)
  }
})


test('new registration does not override an account selected during authorization', async () => {
  const store = memoryStore({ hostId: 'urn:uuid:host', accounts: [account({ clientId: 'oaiapp_other', subject: 'subject-2' })] })
  let nonce, entered, release
  const started = new Promise(resolve => { entered = resolve })
  const proceed = new Promise(resolve => { release = resolve })
  const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: true,
    commitSignIn: commit => commit(),
    fetch: async url => {
      if (url === SIWC_TOKEN) { entered(); await proceed; return json(response(jwt({ nonce }))) }
      if (url === SIWC_JWKS) return json({ keys: [jwk] })
      throw Error('unexpected endpoint')
    } })
  const attempt = await auth.startSignIn()
  const params = (await authorize(attempt)).searchParams
  nonce = params.get('nonce')
  await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
  await started
  await store.modify(async current => ({ ...current, activeClientId: 'oaiapp_other' }))
  release()
  await attempt.result
  const saved = await store.read()
  assert.equal(saved.activeClientId, 'oaiapp_other')
  assert.equal(saved.accounts.find(a => a.clientId === 'oaiapp_test').refreshToken, 'refresh-new')
})

test('cancellation or sign-out before commit prevents activation of returning and new accounts', async () => {
  for (const kind of ['returning', 'new']) for (const action of ['cancel', 'sign-out']) {
    const store = memoryStore({ hostId: 'urn:uuid:host', accounts: kind === 'returning' ? [account()] : [account({ clientId: 'oaiapp_other', subject: 'subject-2' })] })
    let nonce, entered, release, revoked
    const atGate = new Promise(resolve => { entered = resolve })
    const proceed = new Promise(resolve => { release = resolve })
    const lateRevoked = new Promise(resolve => { revoked = resolve })
    const auth = new SiwcAuth({ store, appName: SIWC_AGENT_NAME, now: () => now, activateOnSignIn: true,
      commitSignIn: async commit => { entered(); await proceed; return commit() },
      fetch: async (url, init) => {
        if (url === SIWC_TOKEN) return json(response(jwt({ nonce })))
        if (url === SIWC_JWKS) return json({ keys: [jwk] })
        if (url === SIWC_REVOCATION) { if (init.body.get('token') === 'refresh-new') revoked(); return new Response(null, { status: 200 }) }
        throw Error('unexpected endpoint')
      } })
    const attempt = await auth.startSignIn(kind === 'returning' ? 'oaiapp_test' : undefined)
    const params = (await authorize(attempt)).searchParams
    nonce = params.get('nonce')
    await callback(attempt, { state: params.get('state'), code: 'code', client_id: 'oaiapp_test' })
    await atGate
    if (action === 'cancel') {
      await attempt.cancel()
      await assert.rejects(attempt.result, /cancelled/)
    } else if (kind === 'returning') {
      assert.deepEqual(await auth.signOut('oaiapp_test'), { revoked: false })
    } else {
      assert.deepEqual(await auth.signOutPending(), { revoked: false, hadSession: true })
    }
    release()
    if (action === 'sign-out') await assert.rejects(attempt.result, /superseded/)
    await lateRevoked
    const saved = await store.read()
    assert.equal(saved.activeClientId, undefined, `${kind} ${action}`)
    assert.notEqual(saved.accounts.find(a => a.clientId === 'oaiapp_test')?.refreshToken, 'refresh-new', `${kind} ${action}`)
  }
})
