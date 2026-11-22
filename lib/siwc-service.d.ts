import { type SecretStore } from './siwc-auth.js';
export interface SiwcModel {
    id: string;
    name: string;
}
export interface SiwcIdentity {
    clientId: string;
    subject: string;
    email?: string;
}
type AccountBinding = Pick<SiwcIdentity, 'clientId' | 'subject'>;
interface AccountModelCatalog {
    identity: AccountBinding;
    models: SiwcModel[];
}
export interface SavedAccount extends SiwcIdentity {
    label: string;
    signedIn: boolean;
    active: boolean;
}
export interface SiwcStatus {
    authenticated: boolean;
    email: string | null;
    activeClientId: string | null;
    activeSubject: string | null;
    planUsage: 'enabled' | 'disabled' | 'unknown';
    pendingRegistration: boolean;
    pendingRevocation?: true;
    welcomePending: boolean;
    login: {
        state: 'idle' | 'pending' | 'failed';
        error?: string;
        code?: 'access_denied' | 'invalid_client';
    };
}
export interface SiwcServiceOptions {
    appName?: string;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
    /**
     * Runs at the start of sign-out, before any token is cleared, so a host can
     * quiesce work that still holds the credential. This plugin owns no turns,
     * so its wiring omits it; the hook keeps sign-out ordered for a composition
     * that does.
     */
    beforeSignOut?: () => Promise<void>;
    /**
     * Serialize account changes with host work that must not overlap a
     * credential swap. This plugin owns no turns, so its wiring passes a
     * pass-through; the option stays a seam for a composition that does own
     * turn state and must refuse a change while one is active.
     */
    withAccountChange?: <T>(change: () => Promise<T>) => Promise<T>;
    /**
     * Serialize an account-bound catalog read with account changes. Same seam as
     * {@link withAccountChange}, for reads a change must not interleave with.
     */
    withAccountRead?: <T>(read: () => Promise<T>) => Promise<T>;
}
/** Safe, structured failure. Never include an upstream response body or token. */
export declare class SiwcServiceError extends Error {
    readonly code: string;
    readonly status: number;
    readonly requestId?: string;
    constructor(message: string, code: string, status?: number, requestId?: string);
}
/** Keep credentials out of the local control API and gate account-selection operations with the provider. */
export declare class SiwcService {
    private readonly store;
    private readonly auth;
    private readonly fetcher;
    private readonly gate?;
    private readonly beforeSignOut;
    private readonly readGate?;
    private attempt?;
    private starting?;
    private unsettled?;
    private completion?;
    private generation;
    private loginState;
    private serial;
    private signingOut;
    constructor(store: SecretStore, options?: SiwcServiceOptions);
    private exclusive;
    private change;
    private activeId;
    listAccounts(): Promise<SavedAccount[]>;
    private updateActiveAccount;
    acknowledgeWelcome(clientId: string, subject: string): Promise<{
        ok: true;
    }>;
    /** Start OAuth for the saved registration before making it active. */
    selectAccount(clientId: string): Promise<{
        authUrl: string;
    }>;
    /** Start explicitly authorized browser login. Default reauthorizes the active
     * account; pass {newAccount:true} to register another, or {clientId} to
     * reauthorize and select a saved account. Only returns a loopback ticket. */
    login(options?: {
        clientId?: string;
        newAccount?: boolean;
        retryRegistration?: boolean;
        enablePlan?: boolean;
    }): Promise<{
        authUrl: string;
    }>;
    /** Stop the loopback listener and timer when the plugin is disposed. */
    close(): Promise<void>;
    /** Cancel the pending browser attempt so the user can start a new one. */
    cancelLogin(): Promise<{
        ok: true;
    }>;
    /** Cancel authorization before revoking. An exchange can outlive cancellation;
     * the auth module invalidates its commit and preserves outstanding sessions so
     * signOutPending reports uncertainty instead of falsely claiming revocation. */
    logout(options?: {
        pendingOnly?: boolean;
    }): Promise<{
        ok: true;
        revocation: 'confirmed' | 'unconfirmed' | 'not_applicable';
    }>;
    getIdentity(): Promise<SiwcIdentity | undefined>;
    /**
     * Return a usable bearer for the active account, refreshing it first when it
     * is about to expire.
     * @param minValidityMs - validity the caller needs; a host that republishes
     *   the token on a timer asks for more than the default so the next request
     *   cannot observe an expired bearer.
     */
    getAccessToken(minValidityMs?: number): Promise<string>;
    /** OpenAI's account-visible catalog, not a guarantee of model entitlement.
     * When supplied, expectedIdentity binds the caller's earlier identity snapshot
     * to this read under the gate, before any token is requested. */
    listModels(expectedIdentity?: string): Promise<SiwcModel[]>;
    listModelCatalog(expectedIdentity?: string): Promise<AccountModelCatalog>;
    /** Caller must hold the shared account gate throughout this operation. */
    private listModelsUnlocked;
    /**
     * Report the sign-in surface from the local grant only. No network call is
     * made: the account's live model catalog is served separately by
     * `listModelCatalog()` for the settings page, and nothing here should make a
     * background status poll reach OpenAI.
     */
    status(_options?: {
        light?: boolean;
    }): Promise<SiwcStatus>;
}
export {};
