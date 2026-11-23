import { randomUUID } from 'node:crypto'
import { SiwcAuth, SIWC_AGENT_NAME, SIWC_ISSUER, SiwcOAuthError, hasPendingRegistrationRevocation, hasUnfinishedRevocation, signedIn, type AccountInfo, type SecretStore, type SignInAttempt, type SiwcAccount, type SiwcState } from './siwc-auth.js'

const MODELS_URL = 'https://api.openai.com/v1/models'

export interface SiwcModel { id: string; name: string }
export interface SiwcIdentity { clientId: string; subject: string; email?: string }
type AccountBinding = Pick<SiwcIdentity, 'clientId' | 'subject'>
interface AccountModelCatalog { identity: AccountBinding; models: SiwcModel[] }
export interface SavedAccount extends SiwcIdentity { label: string; signedIn: boolean; active: boolean }
export interface SiwcStatus {
  authenticated: boolean
  email: string | null
  activeClientId: string | null
  activeSubject: string | null
  planUsage: 'enabled' | 'disabled' | 'unknown'
  pendingRegistration: boolean
  pendingRevocation?: true
  welcomePending: boolean
  login: { state: 'idle' | 'pending' | 'failed'; error?: string; code?: 'access_denied' | 'invalid_client' }
}
export interface SiwcServiceOptions {
  appName?: string
  fetch?: typeof globalThis.fetch
  now?: () => number
  /**
   * Runs at the start of sign-out, before any token is cleared, so a host can
   * quiesce work that still holds the credential. This plugin owns no turns,
   * so its wiring omits it; the hook keeps sign-out ordered for a composition
   * that does.
   */
  beforeSignOut?: () => Promise<void>
  /**
   * Serialize account changes with host work that must not overlap a
   * credential swap. This plugin owns no turns, so its wiring passes a
   * pass-through; the option stays a seam for a composition that does own
   * turn state and must refuse a change while one is active.
   */
  withAccountChange?: <T>(change: () => Promise<T>) => Promise<T>
  /**
   * Serialize an account-bound catalog read with account changes. Same seam as
   * {@link withAccountChange}, for reads a change must not interleave with.
   */
  withAccountRead?: <T>(read: () => Promise<T>) => Promise<T>
}

/** Safe, structured failure. Never include an upstream response body or token. */
export class SiwcServiceError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  constructor(message: string, code: string, status = 500, requestId?: string) {
    super(message)
    this.name = 'SiwcServiceError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

function metadata(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : undefined
}
type SubjectState = { subject: string; welcomeAcknowledged?: boolean }
type StateWithSubjects = SiwcState & { subjectStates?: SubjectState[] }

/** Welcome state follows the verified user. Quota can apply to one registration. */
function verifiedSubject(state: SiwcState | undefined, clientId: string): string | undefined {
  const account = state?.accounts.find(item => item.clientId === clientId)
  return account?.issuer === SIWC_ISSUER && account.subject ? account.subject : undefined
}
function subjectState(state: SiwcState | undefined, subject: string): SubjectState | undefined {
  return (state as StateWithSubjects | undefined)?.subjectStates?.find(item => item.subject === subject)
}
function setSubjectState(state: SiwcState, subject: string, patch: Partial<SubjectState>): StateWithSubjects {
  const list = (state as StateWithSubjects).subjectStates ?? []
  return { ...state, subjectStates: [...list.filter(item => item.subject !== subject), { ...subjectState(state, subject), ...patch, subject }] }
}
function publicAccount(account: AccountInfo, active: boolean): SavedAccount {
  // The client ID distinguishes registrations even when emails are identical.
  return { clientId: account.clientId, subject: account.subject, email: account.email,
    label: `${account.email || 'OpenAI account'} (${account.clientId})`, signedIn: account.signedIn, active }
}
function hasRenewableSession(account: SiwcAccount): boolean {
  return !!(account.refreshToken || account.quarantined?.refreshToken
    || account.quarantinedHistory?.some(item => item.refreshToken) || account.refreshPending
    || account.authorizationPending?.length || account.revocationUnconfirmed)
}

/** Keep credentials out of the local control API and gate account-selection operations with the provider. */
export class SiwcService {
  private readonly store: SecretStore
  private readonly auth: SiwcAuth
  private readonly fetcher: typeof globalThis.fetch
  private readonly gate?: SiwcServiceOptions['withAccountChange']
  private readonly beforeSignOut: () => Promise<void>
  private readonly readGate?: SiwcServiceOptions['withAccountRead']
  private attempt?: SignInAttempt
  private starting?: Promise<SignInAttempt>
  private unsettled?: SignInAttempt
  private completion?: Promise<void>
  private generation = 0
  private loginState: SiwcStatus['login'] = { state: 'idle' }
  private serial: Promise<void> = Promise.resolve()
  private signingOut = false

  constructor(store: SecretStore, options: SiwcServiceOptions = {}) {
    this.store = store
    this.fetcher = options.fetch ?? fetch
    this.gate = options.withAccountChange
    this.beforeSignOut = options.beforeSignOut ?? (async () => {})
    this.readGate = options.withAccountRead
    this.auth = new SiwcAuth({ store, appName: options.appName ?? SIWC_AGENT_NAME, fetch: this.fetcher, now: options.now,
      commitSignIn: commit => this.change(commit), activateOnSignIn: true })
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.serial.then(operation)
    this.serial = next.then(() => {}, () => {})
    return next
  }
  private async change<T>(fn: () => Promise<T>, gate = this.gate): Promise<T> {
    if (!gate) throw new SiwcServiceError('Account change is unavailable while turn safety is not configured.', 'ACCOUNT_CHANGE_UNAVAILABLE', 409)
    return gate(fn)
  }
  private async activeId(): Promise<string | undefined> {
    return (await this.store.read() as (Awaited<ReturnType<SecretStore['read']>> & { activeClientId?: string }))?.activeClientId
  }
  async listAccounts(): Promise<SavedAccount[]> {
    const [accounts, active] = await Promise.all([this.auth.listAccounts(), this.activeId()])
    return accounts.map(account => publicAccount(account, account.clientId === active))
  }
  private async updateActiveAccount(clientId: string, subject: string, change: (state: SiwcState, account: SiwcAccount) => SiwcState, gate = this.gate): Promise<void> {
    if (!clientId || !subject) throw new SiwcServiceError('Invalid request.', 'INVALID_REQUEST', 400)
    await this.exclusive(async () => this.change(async () => {
      await this.store.modify(async state => {
        const account = state?.accounts.find(item => item.clientId === clientId && item.accessToken && item.refreshToken)
        if (!state || state.activeClientId !== clientId || !account || verifiedSubject(state, clientId) !== subject) {
          throw new SiwcServiceError('Account changed during subject update.', 'ACCOUNT_CHANGED', 409)
        }
        return change(state, account)
      })
    }, gate))
  }
  async acknowledgeWelcome(clientId: string, subject: string): Promise<{ ok: true }> {
    // Consent is meaningful only for the verified, signed-in account with plan access.
    await this.updateActiveAccount(clientId, subject, (state, account) => {
      if (!account.scopes.includes('chatgpt.tokens.use.direct')) {
        throw new SiwcServiceError('ChatGPT plan permission is not enabled.', 'PLAN_NOT_ENABLED', 409)
      }
      return setSubjectState(state, subject, { welcomeAcknowledged: true })
    })
    return { ok: true }
  }
  /** Start OAuth for the saved registration before making it active. */
  async selectAccount(clientId: string): Promise<{ authUrl: string }> {
    return this.login({ clientId })
  }
  /** Start explicitly authorized browser login. Default reauthorizes the active
   * account; pass {newAccount:true} to register another, or {clientId} to
   * reauthorize and select a saved account. Only returns a loopback ticket. */
  async login(options: { clientId?: string; newAccount?: boolean; retryRegistration?: boolean; enablePlan?: boolean } = {}): Promise<{ authUrl: string }> {
    return this.exclusive(async () => {
      if (this.attempt || this.starting || this.completion) throw new SiwcServiceError('Sign-in is already pending.', 'LOGIN_PENDING', 409)
      if (options.newAccount && (options.clientId !== undefined || options.retryRegistration)
        || options.retryRegistration && options.clientId !== undefined) {
        throw new SiwcServiceError('Choose one sign-in option.', 'INVALID_REQUEST', 400)
      }
      if (!this.gate) throw new SiwcServiceError('Account change is unavailable while turn safety is not configured.', 'ACCOUNT_CHANGE_UNAVAILABLE', 409)
      const state = await this.store.read() as (SiwcState & { lastActiveClientId?: string }) | undefined
      const clientId = options.newAccount || options.retryRegistration ? undefined : options.clientId ?? state?.activeClientId ?? state?.lastActiveClientId
      if (this.signingOut || state?.accounts.some(account => account.clientId === clientId && account.logoutPending)) {
        throw new SiwcServiceError('Finish the pending sign-out before signing in again.', 'LOGOUT_PENDING', 409)
      }
      if (options.clientId !== undefined && !state?.accounts.some(account => account.clientId === options.clientId)) {
        throw new SiwcServiceError('Saved account is unavailable.', 'ACCOUNT_UNAVAILABLE', 404)
      }
      const generation = ++this.generation
      this.loginState = { state: 'pending' }
      try {
        if (generation !== this.generation) throw new SiwcServiceError('Sign-in was cancelled.', 'LOGIN_CANCELLED', 409)
        this.starting = this.auth.startSignIn(clientId, undefined, true, {
          promptConsent: options.enablePlan === true,
          retryRegistration: options.retryRegistration === true,
          activateSelectedAccount: options.clientId !== undefined && options.enablePlan !== true,
        })
        const attempt = await this.starting
        this.starting = undefined
        this.attempt = attempt
        this.unsettled = attempt
        if (generation !== this.generation) await attempt.cancel().catch(() => {})
        const completion = attempt.result.then(async () => {
          // The auth module commits verified credentials and activation atomically.
          if (generation === this.generation) this.loginState = { state: 'idle' }
        }).catch(error => {
          if (generation === this.generation) {
            const code = error instanceof SiwcOAuthError ? error.code : undefined
            this.loginState = { state: 'failed', error: code === 'access_denied'
              ? 'OpenAI authorization was declined or plan usage was not allowed. You can try again.'
              : code === 'invalid_client'
                ? 'OpenAI rejected this client registration. Check its authorization in ChatGPT settings.'
                : 'Sign-in could not be completed. Please try again.',
              ...(code === 'access_denied' || code === 'invalid_client' ? { code } : {}) }
          }
        }).finally(() => {
          if (this.attempt === attempt) this.attempt = undefined
          if (this.unsettled === attempt && !this.signingOut) this.unsettled = undefined
          if (this.completion === completion) this.completion = undefined
        })
        this.completion = completion
        if (generation !== this.generation) throw new SiwcServiceError('Sign-in was cancelled.', 'LOGIN_CANCELLED', 409)
        if (!attempt.launchUrl) {
          await attempt.cancel().catch(() => {})
          throw new SiwcServiceError('Sign-in could not be started.', 'LOGIN_FAILED', 500)
        }
        return { authUrl: attempt.launchUrl }
      } catch (error) {
        this.starting = undefined
        if (generation !== this.generation) throw new SiwcServiceError('Sign-in was cancelled.', 'LOGIN_CANCELLED', 409)
        this.loginState = { state: 'failed', error: 'Sign-in could not be started. Please try again.' }
        if (error instanceof SiwcServiceError) throw error
        throw new SiwcServiceError('Sign-in could not be started. Please try again.', 'LOGIN_FAILED', 500)
      }
    })
  }
  /** Stop the loopback listener and timer when the plugin is disposed. */
  async close(): Promise<void> {
    ++this.generation
    const attempt = this.attempt
    this.attempt = undefined
    this.unsettled = undefined
    if (attempt !== undefined) await attempt.cancel().catch(() => {})
  }

  /** Cancel the pending browser attempt so the user can start a new one. */
  async cancelLogin(): Promise<{ ok: true }> {
    return this.exclusive(async () => {
      const attempt = this.attempt
      ++this.generation
      if (attempt !== undefined) {
        this.attempt = undefined
        this.unsettled = undefined
        await attempt.cancel().catch(() => {})
      }
      // The bumped generation makes any late completion a no-op; dropping the
      // reference lets a new attempt start without waiting on that chain.
      this.completion = undefined
      this.loginState = { state: 'idle' }
      return { ok: true }
    })
  }
  /** Cancel authorization before revoking. An exchange can outlive cancellation;
   * the auth module invalidates its commit and preserves outstanding sessions so
   * signOutPending reports uncertainty instead of falsely claiming revocation. */
  async logout(options: { pendingOnly?: boolean } = {}): Promise<{ ok: true; revocation: 'confirmed' | 'unconfirmed' | 'not_applicable' }> {
    // Invalidate outside the queue so a completion waiting on it cannot activate.
    if (this.signingOut) throw new SiwcServiceError('Sign-out is already in progress.', 'LOGOUT_PENDING', 409)
    this.signingOut = true
    ++this.generation
    await this.attempt?.cancel().catch(() => {})
    try {
      return await this.exclusive(async () => {
        if (!options.pendingOnly) await this.beforeSignOut()
        const attempt = this.unsettled
        await attempt?.cancel().catch(() => {})
        let completed: AccountInfo | undefined
        if (attempt) completed = await attempt.result.catch(() => undefined)
        if (this.unsettled === attempt) this.unsettled = undefined
        return this.change(async () => {
          // Clear the active registration under the same account-change gate as
          // selection and cache writes, retaining its client ID for re-login.
          const selected: { clientId: string; renewable: boolean; generation: string }[] = []
          const pendingIds: string[] = []
          let expectedRegistration: string | undefined
          await this.store.modify(async current => {
            if (!current) return undefined
            const active = current.activeClientId
            expectedRegistration = current.pendingRegistration?.generation
            const ids = options.pendingOnly ? new Set() : new Set([active, completed?.clientId])
            const accounts = current.accounts.map(account => {
              const renewable = hasRenewableSession(account)
              if (account.logoutPending) {
                selected.push({ clientId: account.clientId, renewable, generation: account.logoutPending })
                return account
              }
              if (!ids.has(account.clientId)) {
                if (hasUnfinishedRevocation(account)) pendingIds.push(account.clientId)
                return account
              }
              // Revoke outside this transaction. The durable marker and fresh
              // epochs first block account selection, token use, and stale commits
              // in every runtime sharing the credential record.
              const marked = { ...account, generation: randomUUID(), refreshGeneration: randomUUID() }
              if (!renewable && !account.accessToken && !account.idToken && !account.quarantined && !account.quarantinedHistory?.length) return marked
              const generation = randomUUID()
              selected.push({ clientId: account.clientId, renewable, generation })
              return { ...marked, logoutPending: generation }
            })
            return options.pendingOnly ? undefined : { ...current, accounts, activeClientId: undefined, ...(active ? { lastActiveClientId: active } : {}) }
          })
          let revoked = true, hadSession = false
          for (const account of selected) {
            if (!(await this.auth.signOut(account.clientId, account.generation)).revoked && account.renewable) revoked = false
            hadSession ||= account.renewable
          }
          for (const clientId of pendingIds) {
            const pending = await this.auth.retryRevocation(clientId)
            hadSession ||= pending.hadSession
            if (pending.hadSession && !pending.revoked) revoked = false
          }
          const pending = await this.auth.signOutPending({ expectedGeneration: expectedRegistration })
          if (pending.hadSession && !pending.revoked) revoked = false
          this.loginState = { state: 'idle' }
          return { ok: true as const, revocation: !hadSession && !pending.hadSession ? 'not_applicable' as const : revoked ? 'confirmed' as const : 'unconfirmed' as const }
        })
      })
    } finally { this.signingOut = false }
  }
  async getIdentity(): Promise<SiwcIdentity | undefined> {
    const state = await this.store.read()
    const active = state?.activeClientId
    const account = active && state?.accounts.find(item => item.clientId === active)
    if (!account || !signedIn(account)) return undefined
    return { clientId: account.clientId, subject: account.subject, email: account.email }
  }
  /**
   * Return a usable bearer for the active account, refreshing it first when it
   * is about to expire.
   * @param minValidityMs - validity the caller needs; a host that republishes
   *   the token on a timer asks for more than the default so the next request
   *   cannot observe an expired bearer.
   */
  async getAccessToken(minValidityMs = 60_000): Promise<string> {
    if (this.signingOut) throw new SiwcServiceError('Sign-out is in progress.', 'LOGOUT_PENDING', 409)
    const active = await this.activeId()
    if (!active) throw new SiwcServiceError('No active OpenAI account.', 'MISSING_CREDENTIAL', 401)
    const token = await this.auth.accessToken(active, minValidityMs)
    if (this.signingOut || await this.activeId() !== active) throw new SiwcServiceError('Account changed during token request.', 'ACCOUNT_CHANGED', 409)
    return token
  }
  /** OpenAI's account-visible catalog, not a guarantee of model entitlement.
   * When supplied, expectedIdentity binds the caller's earlier identity snapshot
   * to this read under the gate, before any token is requested. */
  async listModels(expectedIdentity?: string): Promise<SiwcModel[]> {
    return (await this.listModelCatalog(expectedIdentity)).models
  }

  async listModelCatalog(expectedIdentity?: string): Promise<AccountModelCatalog> {
    if (!this.readGate) throw new SiwcServiceError('Account read is unavailable while turn safety is not configured.', 'ACCOUNT_READ_UNAVAILABLE', 409)
    return this.readGate(() => this.listModelsUnlocked(expectedIdentity))
  }
  /** Caller must hold the shared account gate throughout this operation. */
  private async listModelsUnlocked(expectedIdentity?: string, captureToken?: (token: string) => void): Promise<AccountModelCatalog> {
    const identity = await this.getIdentity()
    if (!identity) throw new SiwcServiceError('No active OpenAI account.', 'MISSING_CREDENTIAL', 401)
    if (expectedIdentity !== undefined && expectedIdentity !== `${identity.clientId}\u0000${identity.subject}`) {
      throw new SiwcServiceError('Account changed during model request.', 'ACCOUNT_CHANGED', 409)
    }
    const token = await this.getAccessToken()
    const afterToken = await this.getIdentity()
    if (afterToken?.clientId !== identity.clientId || afterToken.subject !== identity.subject) throw new SiwcServiceError('Account changed during model request.', 'ACCOUNT_CHANGED', 409)
    let response: Response
    try {
      response = await this.fetcher(MODELS_URL, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
    } catch { throw new SiwcServiceError('OpenAI model catalog request failed.', 'MODEL_NETWORK_ERROR', 503) }
    if (!response.ok) {
      let code: string | undefined
      try {
        const body: unknown = await response.json()
        const obj = body as { error?: { code?: unknown } }
        code = metadata(obj?.error?.code)
      } catch {}
      // Upstream metadata is untrusted, including request IDs and machine codes.
      // Never propagate a value containing the actual bearer token.
      if (code?.includes(token)) code = undefined
      let requestId = metadata(response.headers.get('x-request-id'))
      if (requestId?.includes(token)) requestId = undefined
      const known: Record<number, string> = { 401: 'MODEL_UNAUTHORIZED', 403: 'MODEL_FORBIDDEN', 429: 'MODEL_RATE_LIMITED', 503: 'MODEL_UNAVAILABLE' }
      throw new SiwcServiceError('OpenAI model catalog request failed.', code ?? known[response.status] ?? 'MODEL_REQUEST_FAILED', response.status, requestId)
    }
    let body: unknown
    try { body = await response.json() } catch { throw new SiwcServiceError('Invalid OpenAI model catalog response.', 'MODEL_INVALID_RESPONSE', 502) }
    // The SIWC catalog contract is `models`; accept `data` only as a legacy
    // fallback and never let it override an account's official catalog.
    const models = (body as { data?: unknown; models?: unknown })?.models ?? (body as { data?: unknown })?.data
    if (!Array.isArray(models)) throw new SiwcServiceError('Invalid OpenAI model catalog response.', 'MODEL_INVALID_RESPONSE', 502)
    // `read()` may be a stale cross-process snapshot. A no-op modification
    // reconciles credentials under the store lock before validating the token.
    await this.store.modify(async latestState => {
      const latest = latestState?.accounts.find(account => account.clientId === identity.clientId)
      if (latestState?.activeClientId !== identity.clientId || verifiedSubject(latestState, identity.clientId) !== identity.subject
        || latest?.accessToken !== token || !latest.refreshToken || !latest.scopes.includes('chatgpt.tokens.use.direct')) {
        throw new SiwcServiceError('Account changed during model request.', 'ACCOUNT_CHANGED', 409)
      }
      return undefined
    })
    // Keep this token private and short-lived. The cache write rechecks it inside
    // the credential lock so a parallel reauthorization cannot save an old catalog.
    captureToken?.(token)
    const seen = new Set<string>()
    const visible = models.flatMap((model: unknown) => {
      if (!model || typeof model !== 'object') return []
      const item = model as Record<string, unknown>
      if (item.visibility !== 'list') return []
      if ((typeof item.slug === 'string' && item.slug.includes(token))
        || (typeof item.display_name === 'string' && item.display_name.includes(token))) {
        throw new SiwcServiceError('Invalid OpenAI model catalog response.', 'MODEL_INVALID_RESPONSE', 502)
      }
      if (typeof item.slug !== 'string' || !item.slug || seen.has(item.slug)) return []
      seen.add(item.slug)
      return [{ id: item.slug, name: typeof item.display_name === 'string' && item.display_name ? item.display_name : item.slug }]
    })
    return { identity: { clientId: identity.clientId, subject: identity.subject }, models: visible }
  }
  /**
   * Report the sign-in surface from the local grant only. No network call is
   * made: the account's live model catalog is served separately by
   * `listModelCatalog()` for the settings page, and nothing here should make a
   * background status poll reach OpenAI.
   */
  async status(_options: { light?: boolean } = {}): Promise<SiwcStatus> {
    const state = await this.store.read()
    const account = state?.accounts.find(item => item.clientId === state?.activeClientId && signedIn(item))
    const flags = account && verifiedSubject(state, account.clientId) ? subjectState(state, account.subject) : undefined
    const pendingRevocation = hasPendingRegistrationRevocation(state) || state?.accounts.some(hasUnfinishedRevocation)
    return {
      authenticated: !!account, email: account?.email ?? null,
      activeClientId: account?.clientId ?? null, activeSubject: account ? verifiedSubject(state, account.clientId) ?? null : null,
      planUsage: account ? account.scopes.includes('chatgpt.tokens.use.direct') ? 'enabled' : 'disabled' : 'unknown',
      pendingRegistration: !!state?.pendingRegistration?.clientId,
      ...(pendingRevocation ? { pendingRevocation: true as const } : {}),
      welcomePending: !!account && !!verifiedSubject(state, account.clientId)
        && account.scopes.includes('chatgpt.tokens.use.direct') && flags?.welcomeAcknowledged !== true,
      login: { ...this.loginState },
    }
  }
}
