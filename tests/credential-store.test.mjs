import assert from 'node:assert/strict'
import test from 'node:test'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { credentialStore } from '../lib/index.js'

const key = credentialKey('llm-codex-app-server', 'siwc')

/** The real store admits only values a JSON document can represent. */
function assertJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) assertJson(nested)
    return
  }
  throw new TypeError('payload holds a value JSON cannot represent')
}

function provider() {
  let record
  return {
    get record() { return record },
    set record(value) { record = value },
    async readRecord() { return record },
    async modifyRecord(givenKey, mutate) {
      assert.equal(givenKey, key)
      const next = await mutate(record)
      if (next !== undefined) {
        // The real store rejects a payload JSON cannot represent.
        assertJson(next.payload)
        record = next
      }
    },
  }
}

test('writes a JSON-shaped grant and reads it back', async () => {
  const backend = provider()
  const store = credentialStore(backend, key)
  assert.equal(await store.read(), undefined)
  await store.modify(() => ({
    hostId: 'host',
    accounts: [{
      clientId: 'client', issuer: 'https://auth.openai.com', subject: 'subject', email: 'a@b.c',
      accessToken: 'access', refreshToken: 'refresh', idToken: undefined, scopes: ['openid'],
    }],
    pendingRegistration: { generation: 'g', clientId: undefined },
  }))
  assert.deepEqual(backend.record.payload, {
    hostId: 'host',
    accounts: [{
      clientId: 'client', issuer: 'https://auth.openai.com', subject: 'subject', email: 'a@b.c',
      accessToken: 'access', refreshToken: 'refresh', scopes: ['openid'],
    }],
    pendingRegistration: { generation: 'g' },
  })
  const state = await store.read()
  assert.equal(state.hostId, 'host')
  assert.equal(state.accounts[0].refreshToken, 'refresh')
})

test('declining to write leaves the record untouched and refuses foreign payloads', async () => {
  const backend = provider()
  const store = credentialStore(backend, key)
  await store.modify(async () => undefined)
  assert.equal(backend.record, undefined)
  backend.record = { kind: 'grant', payload: { something: 'else' } }
  await assert.rejects(() => store.read(), /unreadable/)
})
