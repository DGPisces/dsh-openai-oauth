import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto'
import { createServer, type Server } from 'node:http'

// This module never touches Codex credentials or the filesystem. The caller must
// supply durable secret storage whose modify operation is exclusive across processes.
export const SIWC_AGENT_NAME = 'dsh-openai-oauth'
export const SIWC_ISSUER = 'https://auth.openai.com'
export const SIWC_AUTHORIZE = `${SIWC_ISSUER}/api/accounts/authorize`
export const SIWC_TOKEN = `${SIWC_ISSUER}/api/accounts/oauth/token`
export const SIWC_JWKS = `${SIWC_ISSUER}/.well-known/jwks.json`
export const SIWC_DISCOVERY = `${SIWC_ISSUER}/.well-known/openid-configuration`
export const SIWC_REVOCATION = `${SIWC_ISSUER}/api/accounts/oauth/revoke`
export const SIWC_RESOURCE = 'https://api.openai.com/v1'
export const SIWC_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const DYNAMIC = 'dynamic_agent_client'
const CALLBACK_PATH = '/auth/callback'
const DIRECT = 'chatgpt.tokens.use.direct'

type Fetch = typeof globalThis.fetch
export interface SiwcAccount {
  clientId: string
  issuer: string
  subject: string
  email?: string
  emailVerified?: boolean
  idToken?: string
  accessToken?: string
  refreshToken?: string
  tokenType?: string
  expiresAt?: number
  /** The issuer's earliest permitted refresh time in epoch milliseconds. */
  earliestRefreshAt?: number
  scopes: string[]
  /** Opaque epoch for invalidating in-flight authorization and refresh work. */
  generation?: string
  /** Separate refresh epoch so a normal refresh does not invalidate authorization. */
  refreshGeneration?: string
  /** Shared between runtimes while an explicit sign-out is being settled. */
  logoutPending?: string
  /** Persisted before network refresh; crash recovery must never reuse the previous token. */
  refreshPending?: boolean
  /** Authorization code exchanges that might still issue a remote session. */
  authorizationPending?: string[]
  /** Remote revocation cannot be confirmed after an uncertain refresh. */
  revocationUnconfirmed?: boolean
  /** Revocation uncertainty that predates an in-progress refresh. */
  refreshPriorUnconfirmed?: boolean
  /** Quarantined credentials must never be used for inference or automatic refresh. */
  quarantined?: { accessToken?: string; refreshToken?: string; idToken?: string; tokenType?: string; expiresAt?: number; scopes: string[]; reason: string }
  /** Historical uncertain sessions are isolated from the currently active grant. */
  quarantinedHistory?: Array<NonNullable<SiwcAccount['quarantined']>>
  /** Last local sign-out result; unknown remote sessions remain unconfirmed. */
  lastRevocation?: 'confirmed' | 'unconfirmed'
}
export interface PendingRegistration { generation: string; clientId?: string; expiresAt?: number; authorizationPending?: string[]; revocationUnconfirmed?: boolean; quarantinedRefreshTokens?: string[] }
export interface RegistrationQuota { clientId: string; subject: string; usageLimitReached: boolean; usageStatusUnknown: boolean }
export interface SiwcState {
  hostId: string
  accounts: SiwcAccount[]
  activeClientId?: string
  lastActiveClientId?: string
  pendingRegistration?: PendingRegistration
  /** Rejected client IDs retained only to reconcile prior uncertain exchanges. */
  detachedRegistrations?: PendingRegistration[]
  subjectStates?: Array<{ subject: string; planUsed?: boolean; welcomeAcknowledged?: boolean; usageLimitReached?: boolean; usageStatusUnknown?: boolean }>
  registrationQuotas?: RegistrationQuota[]
  /** SHA-256 of the scoped DSH session ID to SHA-256 of its verified registration. */
  conversationOwners?: Record<string, string>
}
export interface SignInOptions { promptConsent?: boolean; retryRegistration?: boolean; activateSelectedAccount?: boolean }
/** The update callback MUST run exclusively, including its async work, across all processes sharing this record.
 * Implement with ctx.credentials.modifyRecord; use a private grant record and never expose its payload to the UI. */
export interface SecretStore {
  read(): Promise<SiwcState | undefined>
  modify(update: (current: SiwcState | undefined) => Promise<SiwcState | undefined>): Promise<void>
}
export interface SiwcOptions {
  store: SecretStore; appName: string; fetch?: Fetch; now?: () => number
  /** Wrap the verified credential commit (and activation) with the host's turn gate.
   * Invoke commit exactly once and return its result; the store write is atomic. */
  commitSignIn?: <T>(commit: () => Promise<T>) => Promise<T>
  activateOnSignIn?: boolean
}
export interface AccountInfo { clientId: string; subject: string; email?: string; emailVerified?: boolean; signedIn: boolean; canUsePlan: boolean; expiresAt?: number; revocation?: 'confirmed' | 'unconfirmed' }
export interface SignInAttempt {
  /** One-use loopback navigation capability, containing no credentials. */
  launchUrl: string
  redirectUri: string
  /** Settles after callback, failure, timeout or cancellation; result contains no tokens. */
  result: Promise<AccountInfo>
  cancel(): Promise<void>
}

/** Safe, structured endpoint error. Never contains the server response body or tokens. */
export class SiwcOAuthError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined
  readonly operation: 'token' | 'authorization' | 'refresh'
  readonly reauthorizationRequired: boolean
  /** True means the protected credentials are quarantined; automatic refresh must not be retried. */
  readonly uncertain: boolean
  /** True proves the request never reached the issuer (offline resolution or connect failure). */
  readonly undelivered: boolean
  constructor(status: number | undefined, code: string | undefined, operation: 'token' | 'authorization' | 'refresh', reauthorizationRequired = false, uncertain = false, undelivered = false) {
    super(`SIWC: ${operation} ${reauthorizationRequired ? 'requires reauthorization' : uncertain ? 'outcome uncertain; credentials quarantined' : undelivered ? 'request was not delivered; a retry is safe' : 'failed'}${status ? ` (${status})` : ''}${code ? `: ${code}` : ''}`)
    this.name = 'SiwcOAuthError'
    this.status = status; this.code = code; this.operation = operation; this.reauthorizationRequired = reauthorizationRequired; this.uncertain = uncertain; this.undelivered = undelivered
  }
}

function fail(message: string): never { throw new Error(`SIWC: ${message}`) }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function issued(id: unknown): id is string { return nonempty(id) && id !== DYNAMIC && id.length <= 512 && !/[\s\x00-\x1f]/.test(id) }
export function signedIn(a: SiwcAccount): boolean {
  if (a.issuer !== SIWC_ISSUER || !nonempty(a.subject) || a.logoutPending) return false
  return !!(a.accessToken && a.refreshToken || a.idToken && !a.scopes.includes(DIRECT) && !a.scopes.includes('offline_access'))
}
function isolatedRefreshTokens(account: SiwcAccount): string[] {
  const inUse = new Set([account.refreshToken, account.refreshPending ? account.quarantined?.refreshToken : undefined])
  const candidates = [account.quarantined?.refreshToken, ...(account.quarantinedHistory ?? []).map(grant => grant.refreshToken)]
  return [...new Set(candidates.filter((token): token is string => nonempty(token) && !inUse.has(token)))]
}
function unknownRevocation(account: SiwcAccount): boolean {
  return !!(account.authorizationPending?.length || (account.refreshPending ? account.refreshPriorUnconfirmed : account.revocationUnconfirmed))
}
export function hasUnfinishedRevocation(account: SiwcAccount): boolean {
  return !!account.logoutPending || unknownRevocation(account) || isolatedRefreshTokens(account).length > 0
}
function hasRegistrationSession(registration: PendingRegistration): boolean {
  return !!(registration.authorizationPending?.length || registration.revocationUnconfirmed || registration.quarantinedRefreshTokens?.length)
}
export function hasPendingRegistrationRevocation(state: SiwcState | undefined): boolean {
  return !!(state?.pendingRegistration && hasRegistrationSession(state.pendingRegistration) || state?.detachedRegistrations?.some(hasRegistrationSession))
}
function info(a: SiwcAccount): AccountInfo {
  return { clientId: a.clientId, subject: a.subject, email: a.email, emailVerified: a.emailVerified,
    signedIn: signedIn(a), canUsePlan: signedIn(a) && a.scopes.includes(DIRECT), expiresAt: a.expiresAt,
    ...(hasUnfinishedRevocation(a) ? { revocation: 'unconfirmed' as const } : a.lastRevocation === 'confirmed' ? { revocation: a.lastRevocation } : {}) }
}
function fresh(): string { return randomBytes(32).toString('base64url') }
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
function parseJson(value: string): Record<string, unknown> {
  try { const v: unknown = JSON.parse(value); if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown> } catch {}
  return fail('invalid JSON')
}
function part(value: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return fail('invalid ID token')
  return parseJson(Buffer.from(value, 'base64url').toString('utf8'))
}

/** Verify only RS256, the algorithm in OpenAI production discovery; never trust JWT key URLs. */
export async function verifyIdToken(token: string, clientId: string, nonce: string | undefined, fetcher: Fetch = fetch, now = Date.now()): Promise<{ subject: string; email?: string; emailVerified?: boolean }> {
  const segments = token.split('.')
  if (segments.length !== 3 || segments.some(s => !s || !/^[A-Za-z0-9_-]+$/.test(s))) return fail('invalid ID token')
  const header = part(segments[0]), claims = part(segments[1])
  if (header.alg !== 'RS256' || !nonempty(header.kid) || header.crit !== undefined) return fail('unsupported ID token header')
  let jwks: unknown
  try {
    const response = await fetcher(SIWC_JWKS, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return fail('JWKS request failed')
    jwks = await response.json()
  } catch { return fail('JWKS request failed') }
  const keys = (jwks as { keys?: unknown })?.keys
  if (!Array.isArray(keys)) return fail('invalid JWKS')
  const matching = keys.filter((k: Record<string, unknown>) => k && k.kid === header.kid && k.kty === 'RSA' && (k.alg === undefined || k.alg === 'RS256') && (k.use === undefined || k.use === 'sig') && (k.key_ops === undefined || Array.isArray(k.key_ops) && k.key_ops.includes('verify')))
  if (matching.length !== 1) return fail('unknown or ambiguous signing key')
  let valid = false
  try {
    const key = createPublicKey({ key: matching[0], format: 'jwk' })
    if (key.asymmetricKeyDetails?.modulusLength && key.asymmetricKeyDetails.modulusLength < 2048) return fail('weak signing key')
    valid = verify('RSA-SHA256', Buffer.from(`${segments[0]}.${segments[1]}`), key, Buffer.from(segments[2], 'base64url'))
  } catch { return fail('invalid ID token signature') }
  if (!valid) return fail('invalid ID token signature')
  const seconds = Math.floor(now / 1000)
  const aud = claims.aud
  if (claims.iss !== SIWC_ISSUER || !(aud === clientId || Array.isArray(aud) && aud.includes(clientId) && aud.every(nonempty)) ||
      Array.isArray(aud) && aud.length > 1 && claims.azp !== clientId || claims.azp !== undefined && claims.azp !== clientId ||
      typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= seconds ||
      typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > seconds + 5 ||
      claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > seconds + 5) ||
      !nonempty(claims.sub) || nonce !== undefined && (typeof claims.nonce !== 'string' || !equal(claims.nonce, nonce))) return fail('ID token claims rejected')
  return { subject: claims.sub, email: nonempty(claims.email) ? claims.email : undefined, emailVerified: claims.email_verified === true }
}

interface Tokens { accessToken?: string; refreshToken?: string; idToken?: string; tokenType?: string; expiresAt?: number; earliestRefreshAt?: number; scopes: string[] }
function parseEarliestRefresh(value: unknown): number | undefined {
  const time = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(time) && time > 0 ? time : undefined
}
function tokens(body: Record<string, unknown>, now: number, previousScopes?: string[]): Tokens {
  const scopes = typeof body.scope === 'string' ? [...new Set(body.scope.trim().split(/\s+/).filter(Boolean))] : previousScopes
  if (!scopes) return fail('token response did not include granted scopes')
  if (!previousScopes && body.refresh_token === undefined && nonempty(body.id_token)
    && !scopes.includes(DIRECT) && !scopes.includes('offline_access')) {
    // Keep a verified identity and its login hint when plan use was declined.
    return { idToken: body.id_token, scopes }
  }
  if (!nonempty(body.access_token) || !nonempty(body.refresh_token) || typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer' ||
      typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86400 * 365 ||
      body.id_token !== undefined && !nonempty(body.id_token)) return fail('invalid token response')
  return { accessToken: body.access_token, refreshToken: body.refresh_token, idToken: body.id_token as string | undefined, tokenType: body.token_type, expiresAt: now + body.expires_in * 1000, earliestRefreshAt: parseEarliestRefresh(body.earliest_refresh_at), scopes }
}
const OAUTH_ERRORS = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused', 'invalid_client', 'access_denied', 'temporarily_unavailable', 'server_error'])
function oauthCode(value: unknown): string | undefined { return typeof value === 'string' && OAUTH_ERRORS.has(value) ? value : undefined }
/** Resolution or connect failures that prove no byte of the request reached the issuer.
 * A timeout, an abort, or any response — including an error response — stays ambiguous,
 * because the issuer may already have rotated the refresh token. */
const UNDELIVERED_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'EADDRNOTAVAIL'])
function undelivered(error: unknown): boolean {
  let value: unknown = error
  for (let depth = 0; depth < 5 && value && typeof value === 'object'; depth++) {
    const item = value as { name?: unknown; code?: unknown; cause?: unknown }
    if (item.name === 'TimeoutError' || item.name === 'AbortError') return false
    if (typeof item.code === 'string' && UNDELIVERED_CODES.has(item.code)) return true
    value = item.cause
  }
  return false
}
async function post(fetcher: Fetch, endpoint: string, data: URLSearchParams): Promise<Record<string, unknown>> {
  let response: Response
  try { response = await fetcher(endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: data, redirect: 'error', signal: AbortSignal.timeout(10_000) }) }
  catch (error) { throw new SiwcOAuthError(undefined, undefined, 'token', false, false, undelivered(error)) }
  let value: unknown
  try { value = await response.json() } catch { if (!response.ok) throw new SiwcOAuthError(response.status, undefined, 'token'); return fail('invalid endpoint response') }
  if (!response.ok) throw new SiwcOAuthError(response.status, oauthCode((value as Record<string, unknown> | null)?.error), 'token')
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid endpoint response')
  return value as Record<string, unknown>
}
function clearAccount(account: SiwcAccount): SiwcAccount {
  return { ...account, idToken: undefined, accessToken: undefined, refreshToken: undefined, tokenType: undefined, expiresAt: undefined, earliestRefreshAt: undefined, scopes: [], refreshPending: undefined, quarantined: undefined, quarantinedHistory: undefined }
}

export class SiwcAuth {
  private readonly fetcher: Fetch
  private readonly now: () => number
  private readonly options: SiwcOptions
  private revocationEndpoint?: string
  constructor(options: SiwcOptions) {
    this.options = options
    if (!options.appName.trim()) fail('appName is required')
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }
  async listAccounts(): Promise<AccountInfo[]> { return (await this.options.store.read())?.accounts.map(info) ?? [] }
  private async discoverRevocationEndpoint(): Promise<string> {
    if (this.revocationEndpoint) return this.revocationEndpoint
    const response = await this.fetcher(SIWC_DISCOVERY, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
    if (!response.ok) fail('OIDC discovery failed')
    const discovery = await response.json() as { issuer?: unknown; revocation_endpoint?: unknown } | null
    if (discovery?.issuer !== SIWC_ISSUER || typeof discovery.revocation_endpoint !== 'string') fail('invalid OIDC discovery')
    const endpoint = new URL(discovery.revocation_endpoint)
    if (endpoint.protocol !== 'https:' || endpoint.origin !== SIWC_ISSUER || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('invalid revocation endpoint')
    return this.revocationEndpoint = endpoint.href
  }
  private async revoke(refreshToken: string, clientId: string): Promise<boolean> {
    let rediscovered = false
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const endpoint = await this.discoverRevocationEndpoint()
        const res = await this.fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId }), redirect: 'error', signal: AbortSignal.timeout(10_000) })
        if (res.status === 200) return true
        if (!rediscovered && attempt < 2 && (res.status === 404 || res.status === 410)) {
          rediscovered = true
          if (this.revocationEndpoint === endpoint) this.revocationEndpoint = undefined
          continue
        }
        if (res.status < 500) return false
      } catch {}
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt))
    }
    return false
  }
  private async host(): Promise<string> {
    let result = ''
    await this.options.store.modify(async current => {
      if (current) { if (!nonempty(current.hostId)) fail('invalid stored host'); result = current.hostId; return undefined }
      result = `urn:uuid:${randomUUID()}`
      return { hostId: result, accounts: [] }
    })
    return result
  }
  /** Open launchUrl in the system browser. The actual authorization URL and optional
   * id_token_hint are exposed only in the loopback navigation redirect.
   * retryRegistration reuses an unverified pending client solely for a fresh authorization. */
  async startSignIn(clientId?: string, timeoutMs = 10 * 60 * 1000, includeIdTokenHint = false, signInOptions: SignInOptions = {}): Promise<SignInAttempt> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30 * 60 * 1000) fail('invalid sign-in timeout')
    if (signInOptions.retryRegistration && clientId !== undefined) fail('invalid registration retry')
    if (signInOptions.activateSelectedAccount && clientId === undefined) fail('missing account selection')
    const hostId = await this.host()
    const deadline = this.now() + timeoutMs
    const monotonicDeadline = performance.now() + timeoutMs
    const expired = () => this.now() >= deadline || performance.now() >= monotonicDeadline
    const generation = fresh()
    let selected: SiwcAccount | undefined
    // null captures the absence of an active account, while undefined means sign-in only.
    let activeAtSelection: string | null | undefined
    let retryClientId: string | undefined
    await this.options.store.modify(async current => {
      if (!current || current.hostId !== hostId) fail('host changed during sign-in')
      if (clientId !== undefined) {
        selected = current.accounts.find(a => a.clientId === clientId)
        if (!issued(clientId) || !selected) fail('unknown account')
        if (selected.logoutPending) fail('sign-out is pending')
        if (signInOptions.activateSelectedAccount) activeAtSelection = current.activeClientId ?? null
        return { ...current, accounts: current.accounts.map(a => a.clientId === clientId ? { ...a, generation } : a) }
      }
      if (signInOptions.retryRegistration) {
        retryClientId = current.pendingRegistration?.clientId
        if (!issued(retryClientId)) fail('no pending registration')
      } else if (current.pendingRegistration?.clientId || current.pendingRegistration?.authorizationPending?.length || current.pendingRegistration?.revocationUnconfirmed || current.pendingRegistration?.quarantinedRefreshTokens?.length || (current.pendingRegistration?.expiresAt ?? 0) > this.now()) {
        fail('resolve pending registration before creating another')
      }
      return { ...current, pendingRegistration: { ...current.pendingRegistration, generation, clientId: retryClientId, expiresAt: deadline } }
    })
    const nonce = fresh(), csrf = fresh(), verifier = fresh(), launchTicket = fresh()
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    let authorizationUrl = ''
    let launched = false
    let server: Server
    let resolveResult!: (value: AccountInfo) => void
    let rejectResult!: (reason: Error) => void
    let done = false
    let callbackReceived = false
    let receivedRegistrationClientId: string | undefined
    let cancelled = false
    let commitStarted = false
    const invalidate = async (rejectedClient = false) => {
      cancelled = true
      await this.options.store.modify(async current => {
        if (!current || current.hostId !== hostId) return undefined
        if (selected) {
          const existing = current.accounts.find(a => a.clientId === selected!.clientId)
          if (existing?.generation !== generation) return undefined
          return { ...current, accounts: current.accounts.map(a => a.clientId === selected!.clientId ? { ...a, generation: fresh() } : a) }
        }
        if (current.pendingRegistration?.generation !== generation) return undefined
        const pending = { ...current.pendingRegistration, clientId: current.pendingRegistration.clientId ?? receivedRegistrationClientId }
        const unresolved = hasRegistrationSession(pending)
        const record = { ...pending, generation: fresh(), expiresAt: undefined }
        if (!rejectedClient) return { ...current, pendingRegistration: unresolved || pending.clientId ? record : undefined }
        // A rejected issued ID cannot be retried. Preserve prior remote cleanup
        // state independently so it cannot block registering another account.
        const detachedRegistrations = unresolved ? [...(current.detachedRegistrations ?? []), record] : current.detachedRegistrations
        return { ...current, pendingRegistration: undefined, detachedRegistrations }
      })
    }
    const result = new Promise<AccountInfo>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    // Mark rejection observed even when callers attach their handler only after opening the browser.
    void result.catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    let settling = Promise.resolve()
    const finish = (error?: Error, account?: AccountInfo): Promise<void> => {
      if (done) return settling
      done = true
      if (timer) clearTimeout(timer)
      server.close()
      if (error) {
        cancelled = true
        // Invalidate before exposing failure, so a subsequent registration cannot
        // race with cleanup. Persisted exchange tombstones are never discarded.
        const rejectedClient = error instanceof SiwcOAuthError && (error.code === 'registration_conflict' || error.code === 'invalid_client'
          && (error.operation === 'authorization' || error.status !== undefined && error.status >= 400 && error.status < 500))
        settling = invalidate(rejectedClient).catch(() => {}).then(() => { rejectResult(error) })
      } else resolveResult(account!)
      return settling
    }
    // Once the exclusive store callback has crossed its commit point, cancellation
    // cannot claim failure while a durable write is still in progress.
    const stop = (error: Error): Promise<void> => commitStarted && !done ? result.then(() => {}, () => {}) : finish(error)
    server = createServer((req, res) => {
      const reply = (status: number, text: string) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'", 'x-content-type-options': 'nosniff' }); res.end(text) }
      if (done || callbackReceived || req.method !== 'GET' || req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== new URL(redirectUri).host) { reply(400, 'Invalid request.'); return }
      let url: URL
      try { url = new URL(req.url ?? '', redirectUri) } catch { reply(400, 'Invalid request.'); return }
      if (url.origin !== new URL(redirectUri).origin) { reply(404, 'Not found.'); return }
      if (expired()) { reply(400, 'Sign-in expired.'); void finish(new Error('SIWC: sign-in timed out')); return }
      if (url.pathname === `/auth/start/${launchTicket}` && !url.search) {
        if (launched) { reply(410, 'Authorization link already used.'); return }
        launched = true
        // No CORS: JS in the Harness UI cannot inspect the cross-origin redirect.
        // The ID-token hint goes only in a navigation to the fixed OpenAI endpoint.
        res.writeHead(303, { location: authorizationUrl, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'", 'x-content-type-options': 'nosniff' })
        res.end()
        return
      }
      if (url.pathname !== CALLBACK_PATH) { reply(404, 'Not found.'); return }
      const params = url.searchParams
      if (params.getAll('state').length !== 1 || !equal(params.get('state')!, csrf)) { reply(400, 'Invalid request.'); return }
      // Only a matching state can consume the attempt. Consume before any async work.
      if (params.has('error')) {
        const code = params.getAll('error').length === 1 && !params.has('code') ? oauthCode(params.get('error')) : undefined
        reply(400, 'Sign-in could not be completed.'); void finish(new SiwcOAuthError(undefined, code, 'authorization')); return
      }
      if (params.getAll('code').length !== 1 || !nonempty(params.get('code')) || params.getAll('client_id').length > 1) {
        reply(400, 'Sign-in could not be completed.'); finish(new Error('SIWC: authorization failed')); return
      }
      const returned = params.get('client_id')
      const expectedClient = selected?.clientId ?? retryClientId
      const actual = expectedClient ?? returned
      if (!issued(actual) || expectedClient && returned !== null && returned !== expectedClient) {
        reply(400, 'Sign-in could not be completed.'); finish(new Error('SIWC: invalid issued client ID')); return
      }
      const code = params.get('code')!
      if (!selected) receivedRegistrationClientId = actual
      callbackReceived = true
      server.close()
      reply(200, 'Sign-in received. You can close this window.')
      // The deadline covers exchange, verification and gated commit too. A late
      // response must be revoked/quarantined rather than restoring credentials.
      void this.completeSignIn(actual, hostId, selected, generation, () => cancelled || expired(), () => { commitStarted = true }, code, verifier, nonce, redirectUri, activeAtSelection)
        .then(account => { void finish(undefined, account) }, error => { void finish(error instanceof Error ? error : new Error('SIWC: sign-in failed')) })
    })
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
    } catch {
      await invalidate().catch(() => {})
      fail('loopback listener failed')
    }
    const address = server.address()
    if (!address || typeof address === 'string') { server.close(); await invalidate().catch(() => {}); fail('loopback listener failed') }
    const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
    const params = new URLSearchParams({ client_id: selected?.clientId ?? retryClientId ?? DYNAMIC, ext_agent_host_id: hostId, response_type: 'code', redirect_uri: redirectUri, scope: SIWC_SCOPES, resource: SIWC_RESOURCE, state: csrf, nonce, code_challenge_method: 'S256', code_challenge: challenge })
    if (selected) { if (includeIdTokenHint && selected.idToken) params.set('id_token_hint', selected.idToken); if (selected.email) params.set('login_hint', selected.email) }
    else if (!retryClientId) params.set('agent_name_hint', this.options.appName)
    if (signInOptions.promptConsent) params.set('prompt', 'consent')
    authorizationUrl = `${SIWC_AUTHORIZE}?${params}`
    const launchUrl = `http://127.0.0.1:${address.port}/auth/start/${launchTicket}`
    timer = setTimeout(() => { void stop(new Error('SIWC: sign-in timed out')) }, Math.max(1, Math.min(deadline - this.now(), monotonicDeadline - performance.now())))
    timer.unref()
    return { launchUrl, redirectUri, result, cancel: async () => { await stop(new Error('SIWC: sign-in cancelled')) } }
  }
  private async completeSignIn(clientId: string, hostId: string, selected: SiwcAccount | undefined, generation: string, cancelled: () => boolean, markCommitting: () => void, code: string, verifier: string, nonce: string, redirectUri: string, activeAtSelection: string | null | undefined): Promise<AccountInfo> {
    await this.options.store.modify(async current => {
      if (cancelled() || !current || current.hostId !== hostId) fail('sign-in superseded')
      if (selected) {
        const account = current.accounts.find(a => a.clientId === clientId)
        if (account?.generation !== generation || account.logoutPending) fail('sign-in superseded')
        return { ...current, accounts: current.accounts.map(a => a.clientId === clientId ? { ...a, authorizationPending: [...(a.authorizationPending ?? []), generation] } : a) }
      }
      if (current.pendingRegistration?.generation !== generation) fail('sign-in superseded')
      if (current.accounts.some(a => a.clientId === clientId) || current.detachedRegistrations?.some(item => item.clientId === clientId)) {
        throw new SiwcOAuthError(undefined, 'registration_conflict', 'authorization')
      }
      return { ...current, pendingRegistration: { ...current.pendingRegistration, generation, clientId, authorizationPending: [...(current.pendingRegistration.authorizationPending ?? []), generation] } }
    })
    let rawRefresh: string | undefined
    let identityOnly = false
    try {
    const data = await post(this.fetcher, SIWC_TOKEN, new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: SIWC_RESOURCE }))
    rawRefresh = nonempty(data.refresh_token) ? data.refresh_token : undefined
    const t = tokens(data, this.now())
    identityOnly = t.refreshToken === undefined
    if (!t.idToken) fail('ID token missing')
    const identity = await verifyIdToken(t.idToken!, clientId, nonce, this.fetcher, this.now())
    if (selected && (identity.subject !== selected.subject || selected.issuer !== SIWC_ISSUER)) fail('account identity changed')
    let account: SiwcAccount = { clientId, issuer: SIWC_ISSUER, subject: identity.subject, email: identity.email, emailVerified: identity.emailVerified, ...t, generation: fresh() }
    let committed = false
    const commit = async () => {
      await this.options.store.modify(async current => {
      if (cancelled() || !current || current.hostId !== hostId) fail('sign-in superseded')
      const existing = current.accounts.find(a => a.clientId === clientId)
      if (existing && (existing.subject !== identity.subject || existing.issuer !== SIWC_ISSUER)) fail('account identity changed')
      if (selected ? existing?.generation !== generation || existing.logoutPending : current.pendingRegistration?.generation !== generation || current.pendingRegistration.clientId !== clientId || !!existing) fail('sign-in superseded')
      if (activeAtSelection !== undefined && (current.activeClientId ?? null) !== activeAtSelection) fail('active account changed during sign-in')
      const registration = selected ? undefined : current.pendingRegistration
      // A replacement authorization may create a separate renewable session.
      // Retain the old refresh token solely for later revocation, never inference.
      const previous = existing?.refreshToken && existing.refreshToken !== t.refreshToken
        ? [{ refreshToken: existing.refreshToken, scopes: [], reason: 'replaced_session' }] : []
      const history = [...(existing?.quarantinedHistory ?? []), ...(existing?.quarantined ? [existing.quarantined] : []), ...previous, ...(registration?.quarantinedRefreshTokens ?? []).map(refreshToken => ({ refreshToken, scopes: [], reason: 'authorization_unverified' }))]
      const remainingPending = [...(existing?.authorizationPending ?? []), ...(registration?.authorizationPending ?? [])].filter(id => id !== generation)
      account = { ...account, revocationUnconfirmed: existing?.revocationUnconfirmed || registration?.revocationUnconfirmed, quarantinedHistory: history.length ? history : undefined, authorizationPending: remainingPending.length ? remainingPending : undefined }
      // Activation and verified credentials are committed under the same turn gate.
      const activate = activeAtSelection !== undefined || (this.options.activateOnSignIn && !current.activeClientId)
      const activeClientId = activate ? clientId : current.activeClientId
      markCommitting()
      return { ...current, activeClientId,
        pendingRegistration: selected ? current.pendingRegistration : undefined, accounts: [...current.accounts.filter(a => a.clientId !== clientId), account] }
      })
      committed = true
    }
    try {
      if (this.options.commitSignIn) await this.options.commitSignIn(commit)
      else await commit()
    } catch (error) {
      // A gate or durable store can fail after committing. Do not revoke a token
      // that is already the live account. The unique generation identifies this write.
      if (!committed) {
        const saved = await this.options.store.read().catch(() => undefined)
        committed = saved?.hostId === hostId && !!saved.accounts.find(a => a.clientId === clientId && a.generation === account.generation && a.refreshToken === t.refreshToken)
      }
      if (!committed) throw error
    }
    if (!committed) fail('sign-in commit not performed')
    return info(account)
    } catch (error) {
      const exchangeRejected = !rawRefresh && error instanceof SiwcOAuthError && !!error.status && error.status >= 400 && error.status < 500 && !!error.code && ['invalid_grant', 'invalid_client'].includes(error.code)
      const revoked = rawRefresh ? await this.revoke(rawRefresh, clientId) : exchangeRejected || identityOnly
      // A known refresh token can be retried for revocation; only an outcome
      // without a known token represents an irrecoverably unknown session. An
      // undelivered exchange never created a session, so it stays unknown-free.
      const unknownSession = !revoked && !rawRefresh && !(error instanceof SiwcOAuthError && error.undelivered)
      if (!selected) {
        try { await this.options.store.modify(async current => {
          if (!current || current.hostId !== hostId) return undefined
          const pending = current.pendingRegistration
          const settle = (registration: PendingRegistration): PendingRegistration => ({
            ...registration, authorizationPending: registration.authorizationPending?.filter(id => id !== generation),
            revocationUnconfirmed: registration.revocationUnconfirmed || unknownSession || undefined,
            quarantinedRefreshTokens: [...(registration.quarantinedRefreshTokens ?? []), ...(!revoked && rawRefresh ? [rawRefresh] : [])],
          })
          if (pending?.clientId === clientId) return { ...current, pendingRegistration: settle(pending) }
          if (current.detachedRegistrations?.some(item => item.clientId === clientId)) {
            const detachedRegistrations = current.detachedRegistrations.map(item => item.clientId === clientId ? settle(item) : item).filter(hasRegistrationSession)
            return { ...current, detachedRegistrations: detachedRegistrations.length ? detachedRegistrations : undefined }
          }
          const existing = current.accounts.find(a => a.clientId === clientId)
          if (!existing) return undefined
          const history = [...(existing.quarantinedHistory ?? []), ...(!revoked && rawRefresh ? [{ refreshToken: rawRefresh, scopes: [], reason: 'authorization_unverified' }] : [])]
          return { ...current, accounts: current.accounts.map(a => a.clientId === clientId ? { ...a, authorizationPending: a.authorizationPending?.filter(id => id !== generation), revocationUnconfirmed: a.revocationUnconfirmed || unknownSession || undefined, refreshPriorUnconfirmed: a.refreshPending ? a.refreshPriorUnconfirmed || unknownSession : undefined, quarantinedHistory: history.length ? history : undefined } : a) }
        }) } catch {}
      }
      if (selected) {
        try { await this.options.store.modify(async current => {
          const existing = current?.accounts.find(a => a.clientId === clientId)
          if (!current || !existing || current.hostId !== hostId) return undefined
          const history = [...(existing.quarantinedHistory ?? [])]
          if (rawRefresh && !revoked) history.push({ refreshToken: rawRefresh, scopes: [], reason: 'authorization_unverified' })
          return { ...current, accounts: current.accounts.map(a => a.clientId === clientId ? { ...a, authorizationPending: a.authorizationPending?.filter(id => id !== generation), revocationUnconfirmed: a.revocationUnconfirmed || unknownSession || undefined, refreshPriorUnconfirmed: a.refreshPending ? a.refreshPriorUnconfirmed || unknownSession : undefined, quarantinedHistory: history.length ? history : undefined } : a) }
        }) } catch {}
      }
      throw error
    }
  }
  /** Returns a token only to trusted server code, and refuses inference without the granted direct scope.
   * A refresh commits quarantine before network I/O: ambiguous failures freeze the old token.
   * Uncertain grants require explicit reauthorization or sign-out; retrying accessToken never resends them. */
  async accessToken(clientId: string, minValidityMs = 60_000): Promise<string> {
    if (!issued(clientId) || !Number.isFinite(minValidityMs) || minValidityMs < 0) fail('invalid access request')
    const waitDeadline = Date.now() + 25_000
    for (;;) {
      let token: string | undefined
      let generation: string | undefined
      let oldRefresh: string | undefined
      let original: SiwcAccount | undefined
      let wait = false
      await this.options.store.modify(async current => {
        const account = current?.accounts.find(a => a.clientId === clientId)
        if (account?.logoutPending) fail('sign-out is pending')
        if (account && signedIn(account) && !account.scopes.includes(DIRECT)) fail('ChatGPT plan permission not granted')
        if (!account || !account.accessToken || !account.refreshToken || !account.expiresAt) {
          if (account?.refreshPending) { wait = true; return undefined }
          if (account?.quarantined) throw new SiwcOAuthError(undefined, account.quarantined.reason === 'invalid_client' ? 'invalid_client' : 'refresh_uncertain', 'refresh', false, true)
          fail('account is signed out')
        }
        if (account.refreshPending) { wait = true; return undefined }
        if (!account.scopes.includes(DIRECT)) fail('ChatGPT plan permission not granted')
        const now = this.now()
        const refreshNotReady = (account.earliestRefreshAt ?? 0) > now
        if (account.expiresAt! > now + minValidityMs || refreshNotReady && account.expiresAt! > now) {
          token = account.accessToken
          return undefined
        }
        if (refreshNotReady) throw new SiwcOAuthError(503, 'refresh_not_ready', 'refresh')
        generation = fresh()
        oldRefresh = account.refreshToken
        original = account
        // Commit an unusable quarantine before sending: crash recovery cannot reuse it.
        const quarantined = { accessToken: account.accessToken, refreshToken: account.refreshToken, idToken: account.idToken, tokenType: account.tokenType, expiresAt: account.expiresAt, scopes: account.scopes, reason: 'refresh_uncertain' }
        const pending = { ...clearAccount(account), quarantined, quarantinedHistory: account.quarantinedHistory, refreshGeneration: generation, refreshPending: true, revocationUnconfirmed: true, refreshPriorUnconfirmed: !!account.revocationUnconfirmed }
        return { ...current!, accounts: current!.accounts.map(a => a.clientId === clientId ? pending : a) }
      })
      if (token) return token
      if (wait) { if (Date.now() >= waitDeadline) throw new SiwcOAuthError(undefined, 'refresh_uncertain', 'refresh', false, true); await new Promise(resolve => setTimeout(resolve, 100)); continue }
      if (!oldRefresh || !generation) fail('refresh unavailable')
      let failure: Error | undefined
      await this.options.store.modify(async current => {
        const account = current?.accounts.find(a => a.clientId === clientId)
        if (!account || account.refreshGeneration !== generation || !account.refreshPending) fail('refresh superseded')
        let updated: SiwcAccount
        let replacement: Tokens | undefined
        let rawRefresh: string | undefined
        try {
          const data = await post(this.fetcher, SIWC_TOKEN, new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: oldRefresh!, resource: SIWC_RESOURCE }))
          rawRefresh = nonempty(data.refresh_token) ? data.refresh_token : undefined
          const t = replacement = tokens(data, this.now(), original?.scopes)
          if (t.idToken) {
            const identity = await verifyIdToken(t.idToken, clientId, undefined, this.fetcher, this.now())
            if (identity.subject !== account.subject || account.issuer !== SIWC_ISSUER) fail('account identity changed')
          }
          updated = { ...account, ...t, idToken: t.idToken ?? original?.idToken, refreshPending: undefined, quarantined: undefined, revocationUnconfirmed: account.refreshPriorUnconfirmed || undefined, refreshPriorUnconfirmed: undefined }
          token = updated.scopes.includes(DIRECT) ? updated.accessToken : undefined
        } catch (error) {
          const oauth = error instanceof SiwcOAuthError ? error : undefined
          // Only terminal refresh codes delete the grant. Other outcomes quarantine it:
          // even a 5xx can arrive after rotation, so it must never be retried blindly.
          const terminal = !!oauth?.code && ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(oauth.code)
          // A request that provably never left this machine cannot have rotated the
          // refresh token, so the pre-refresh grant is restored instead of quarantined.
          const restore = oauth?.undelivered === true ? original : undefined
          failure = restore ? new SiwcOAuthError(undefined, oauth?.code, 'refresh', false, false, true) : new SiwcOAuthError(oauth?.status, oauth?.code, 'refresh', terminal, !terminal)
          const preserved = replacement ? { ...replacement, reason: 'replacement_unverified' } : rawRefresh ? { refreshToken: rawRefresh, scopes: [], reason: 'replacement_unverified' } : account.quarantined && { ...account.quarantined, reason: oauth?.code === 'invalid_client' ? 'invalid_client' : 'refresh_uncertain' }
          updated = restore ? restore : terminal ? { ...clearAccount(account), quarantinedHistory: account.quarantinedHistory, revocationUnconfirmed: true } : { ...account, refreshPending: undefined, revocationUnconfirmed: true, quarantined: preserved }
        }
        return { ...current!, accounts: current!.accounts.map(a => a.clientId === clientId ? updated : a) }
      })
      if (failure) throw failure
      if (!token) fail('ChatGPT plan permission not granted')
      return token
    }
  }
  /** Revoke the selected renewable grant and clear its local credentials. */
  async signOut(clientId: string, logoutGeneration?: string): Promise<{ revoked: boolean }> {
    if (!issued(clientId)) fail('invalid account')
    let revoked = false
    await this.options.store.modify(async current => {
      const account = current?.accounts.find(a => a.clientId === clientId)
      if (!account) fail('unknown account')
      if (logoutGeneration !== undefined && account.logoutPending !== logoutGeneration) {
        revoked = !account.logoutPending && !signedIn(account) && account.lastRevocation === 'confirmed' && !hasUnfinishedRevocation(account)
        return undefined
      }
      const refreshTokens = [...new Set([account.refreshToken, account.quarantined?.refreshToken, ...(account.quarantinedHistory ?? []).map(q => q.refreshToken)].filter(nonempty))]
      const failedTokens: string[] = []
      for (const refreshToken of refreshTokens) {
        if (!(await this.revoke(refreshToken, clientId))) failedTokens.push(refreshToken)
      }
      const unknownSession = account.revocationUnconfirmed || account.refreshPending || failedTokens.length > 0
      const hasSession = refreshTokens.length > 0 || unknownSession || !!account.authorizationPending?.length
      revoked = (refreshTokens.length > 0 || account.lastRevocation === 'confirmed')
        && !failedTokens.length && !unknownSession && !account.authorizationPending?.length
      const cleared: SiwcAccount = { ...clearAccount(account), generation: fresh(), refreshGeneration: fresh(),
        logoutPending: undefined, revocationUnconfirmed: unknownSession || undefined, refreshPriorUnconfirmed: undefined,
        lastRevocation: hasSession ? revoked ? 'confirmed' : 'unconfirmed' : account.lastRevocation }
      return { ...current!, accounts: current!.accounts.map(a => a.clientId === clientId ? cleared : a) }
    })
    return { revoked }
  }

  /** Retry quarantined grants while leaving any usable grant and active registration untouched. */
  async retryRevocation(clientId: string): Promise<{ revoked: boolean; hadSession: boolean }> {
    let revoked = false, hadSession = false
    await this.options.store.modify(async current => {
      const account = current?.accounts.find(a => a.clientId === clientId)
      if (!current || !account || account.issuer !== SIWC_ISSUER || !issued(clientId)) return undefined
      if (account.logoutPending) { hadSession = true; return undefined }
      const tokens = isolatedRefreshTokens(account)
      const unknown = unknownRevocation(account)
      hadSession = tokens.length > 0 || unknown
      if (!tokens.length) return undefined
      const confirmed = new Set<string>()
      for (const token of tokens) if (await this.revoke(token, clientId)) confirmed.add(token)
      revoked = confirmed.size === tokens.length && !unknown
      if (!confirmed.size) return undefined
      const history = account.quarantinedHistory?.filter(item => !item.refreshToken || !confirmed.has(item.refreshToken))
      const updated = { ...account, quarantinedHistory: history?.length ? history : undefined,
        quarantined: account.quarantined?.refreshToken && confirmed.has(account.quarantined.refreshToken) ? undefined : account.quarantined,
        lastRevocation: revoked && !signedIn(account) ? 'confirmed' as const : account.lastRevocation }
      return { ...current, accounts: current.accounts.map(item => item.clientId === clientId ? updated : item) }
    })
    return { revoked, hadSession }
  }

  /** Revoke an unverified registration's quarantined tokens without discarding its issued client ID.
   * Keep failed tokens solely for another revocation attempt. Outstanding exchanges and
   * previously unknown sessions can never be reported as confirmed. */
  async signOutPending(options?: { expectedGeneration?: string }): Promise<{ revoked: boolean; hadSession: boolean }> {
    let revoked = true, hadSession = false
    await this.options.store.modify(async current => {
      if (!current) return undefined
      const pending = current.pendingRegistration
      const settlePending = pending && (options === undefined || pending.generation === options.expectedGeneration)
      if (!settlePending && !current.detachedRegistrations?.length) return undefined
      const settle = async (registration: PendingRegistration): Promise<PendingRegistration> => {
        const refreshTokens = [...new Set((registration.quarantinedRefreshTokens ?? []).filter(nonempty))]
        hadSession ||= hasRegistrationSession(registration)
        const failedTokens: string[] = []
        for (const token of refreshTokens) {
          if (!(issued(registration.clientId) && await this.revoke(token, registration.clientId))) failedTokens.push(token)
        }
        if (failedTokens.length || registration.revocationUnconfirmed || registration.authorizationPending?.length) revoked = false
        return { ...registration, generation: fresh(), expiresAt: undefined, quarantinedRefreshTokens: failedTokens.length ? failedTokens : undefined }
      }
      const pendingRegistration = settlePending ? await settle(pending) : pending
      const detachedRegistrations = []
      for (const registration of current.detachedRegistrations ?? []) {
        const settled = await settle(registration)
        if (hasRegistrationSession(settled)) detachedRegistrations.push(settled)
      }
      return { ...current, pendingRegistration, detachedRegistrations: detachedRegistrations.length ? detachedRegistrations : undefined }
    })
    return { revoked: hadSession && revoked, hadSession }
  }
}
