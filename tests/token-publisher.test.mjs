import assert from 'node:assert/strict'
import test from 'node:test'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ACCESS_TOKEN_ENV, TokenPublisher } from '../lib/token-publisher.js'
import { SiwcOAuthError } from '../lib/siwc-auth.js'
import { SiwcServiceError } from '../lib/siwc-service.js'

const REF = credentialRef('OPENAI_CHATGPT_ACCESS_TOKEN')

/** Records every credential write without storing anything. */
function fakeCredentials() {
  const calls = []
  let value
  return {
    calls,
    value: () => value,
    async set(ref, next) { calls.push(['set', ref, next]); value = next },
    async unset(ref) { calls.push(['unset', ref]); value = undefined },
  }
}

/** A stand-in for the SIWC service: the publisher only needs identity and a token. */
function fakeService(token, identity = { clientId: 'client-a', subject: 'subject-a' }) {
  return {
    calls: 0,
    minValidity: undefined,
    async getIdentity() { return identity },
    async getAccessToken(minValidityMs) { this.calls++; this.minValidity = minValidityMs; return typeof token === 'function' ? token() : token },
  }
}

test('publishes the active account token to the documented reference', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('token-one')
  const publisher = new TokenPublisher({ credentials, service, logger: { warn() {} } })
  await publisher.refresh()
  assert.equal(ACCESS_TOKEN_ENV, 'OPENAI_CHATGPT_ACCESS_TOKEN')
  assert.deepEqual(credentials.calls, [['set', REF, 'token-one']])
  assert.equal(service.minValidity >= 60_000, true, 'asks for enough validity to cover a refresh tick')
})

test('does not rewrite an unchanged token', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('token-one')
  const publisher = new TokenPublisher({ credentials, service, logger: { warn() {} } })
  await publisher.refresh()
  await publisher.refresh()
  await publisher.refresh()
  assert.equal(credentials.calls.length, 1)
  assert.equal(service.calls, 3, 'still rechecks the grant every tick')
})

test('republishes when the grant rotates', async () => {
  const credentials = fakeCredentials()
  let token = 'token-one'
  const publisher = new TokenPublisher({ credentials, service: fakeService(() => token), logger: { warn() {} } })
  await publisher.refresh()
  token = 'token-two'
  await publisher.refresh()
  assert.deepEqual(credentials.calls, [['set', REF, 'token-one'], ['set', REF, 'token-two']])
})

test('removes the reference once nobody is signed in', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('token-one')
  const publisher = new TokenPublisher({ credentials, service, logger: { warn() {} } })
  await publisher.refresh()
  service.getIdentity = async () => undefined
  await publisher.refresh()
  await publisher.refresh()
  assert.deepEqual(credentials.calls, [['set', REF, 'token-one'], ['unset', REF]])
})

test('clears a stale reference when the plugin starts signed out', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('unused')
  service.getIdentity = async () => undefined
  const publisher = new TokenPublisher({ credentials, service, logger: { warn() {} } })
  await publisher.refresh()
  assert.deepEqual(credentials.calls, [['unset', REF]], 'an absent account must not leave a previous process token behind')
})

test('keeps the last published token while the issuer has not opened the refresh window', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('token-one')
  const publisher = new TokenPublisher({ credentials, service, logger: { warn() {} } })
  await publisher.refresh()
  const notReady = new SiwcOAuthError(503, 'refresh_not_ready', 'refresh')
  service.getAccessToken = async () => { throw notReady }
  await publisher.refresh()
  assert.deepEqual(credentials.calls, [['set', REF, 'token-one']], 'a refused refresh is not a sign-out')
})

test('drops the reference when the grant needs reauthorization', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('token-one')
  const publisher = new TokenPublisher({ credentials, service, logger: { warn() {} } })
  await publisher.refresh()
  service.getAccessToken = async () => { throw new SiwcOAuthError(400, 'invalid_grant', 'refresh', true) }
  await publisher.refresh()
  assert.deepEqual(credentials.calls, [['set', REF, 'token-one'], ['unset', REF]])
})

test('treats a missing active account as a sign-out, not a failure', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('token-one')
  const publisher = new TokenPublisher({ credentials, service, logger: { warn() {} } })
  await publisher.refresh()
  service.getAccessToken = async () => { throw new SiwcServiceError('No active OpenAI account.', 'MISSING_CREDENTIAL', 401) }
  await publisher.refresh()
  assert.deepEqual(credentials.calls, [['set', REF, 'token-one'], ['unset', REF]])
})

test('a concurrent refresh collapses into the one already running', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('token-one')
  const publisher = new TokenPublisher({ credentials, service, logger: { warn() {} } })
  await Promise.all([publisher.refresh(), publisher.refresh(), publisher.refresh()])
  assert.equal(service.calls, 1)
  assert.equal(credentials.calls.length, 1)
})

test('start publishes immediately and stop halts the timer', async () => {
  const credentials = fakeCredentials()
  const service = fakeService('token-one')
  const publisher = new TokenPublisher({ credentials, service, intervalMs: 5, logger: { warn() {} } })
  publisher.start()
  publisher.start()
  await new Promise(resolve => setTimeout(resolve, 30))
  publisher.stop()
  const calls = service.calls
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(service.calls, calls, 'no publish after stop')
  assert.equal(credentials.value(), 'token-one')
})
