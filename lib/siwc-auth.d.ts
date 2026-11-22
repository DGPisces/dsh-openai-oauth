export declare const SIWC_AGENT_NAME = "dsh-openai-oauth";
export declare const SIWC_ISSUER = "https://auth.openai.com";
export declare const SIWC_AUTHORIZE = "https://auth.openai.com/api/accounts/authorize";
export declare const SIWC_TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
export declare const SIWC_JWKS = "https://auth.openai.com/.well-known/jwks.json";
export declare const SIWC_DISCOVERY = "https://auth.openai.com/.well-known/openid-configuration";
export declare const SIWC_REVOCATION = "https://auth.openai.com/api/accounts/oauth/revoke";
export declare const SIWC_RESOURCE = "https://api.openai.com/v1";
export declare const SIWC_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
type Fetch = typeof globalThis.fetch;
export interface SiwcAccount {
    clientId: string;
    issuer: string;
    subject: string;
    email?: string;
    emailVerified?: boolean;
    idToken?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    expiresAt?: number;
    /** The issuer's earliest permitted refresh time in epoch milliseconds. */
    earliestRefreshAt?: number;
    scopes: string[];
    /** Opaque epoch for invalidating in-flight authorization and refresh work. */
    generation?: string;
    /** Separate refresh epoch so a normal refresh does not invalidate authorization. */
    refreshGeneration?: string;
    /** Shared between runtimes while an explicit sign-out is being settled. */
    logoutPending?: string;
    /** Persisted before network refresh; crash recovery must never reuse the previous token. */
    refreshPending?: boolean;
    /** Authorization code exchanges that might still issue a remote session. */
    authorizationPending?: string[];
    /** Remote revocation cannot be confirmed after an uncertain refresh. */
    revocationUnconfirmed?: boolean;
    /** Revocation uncertainty that predates an in-progress refresh. */
    refreshPriorUnconfirmed?: boolean;
    /** Quarantined credentials must never be used for inference or automatic refresh. */
    quarantined?: {
        accessToken?: string;
        refreshToken?: string;
        idToken?: string;
        tokenType?: string;
        expiresAt?: number;
        scopes: string[];
        reason: string;
    };
    /** Historical uncertain sessions are isolated from the currently active grant. */
    quarantinedHistory?: Array<NonNullable<SiwcAccount['quarantined']>>;
    /** Last local sign-out result; unknown remote sessions remain unconfirmed. */
    lastRevocation?: 'confirmed' | 'unconfirmed';
}
export interface PendingRegistration {
    generation: string;
    clientId?: string;
    expiresAt?: number;
    authorizationPending?: string[];
    revocationUnconfirmed?: boolean;
    quarantinedRefreshTokens?: string[];
}
export interface RegistrationQuota {
    clientId: string;
    subject: string;
    usageLimitReached: boolean;
    usageStatusUnknown: boolean;
}
export interface SiwcState {
    hostId: string;
    accounts: SiwcAccount[];
    activeClientId?: string;
    lastActiveClientId?: string;
    pendingRegistration?: PendingRegistration;
    /** Rejected client IDs retained only to reconcile prior uncertain exchanges. */
    detachedRegistrations?: PendingRegistration[];
    subjectStates?: Array<{
        subject: string;
        planUsed?: boolean;
        welcomeAcknowledged?: boolean;
        usageLimitReached?: boolean;
        usageStatusUnknown?: boolean;
    }>;
    registrationQuotas?: RegistrationQuota[];
    /** SHA-256 of the scoped DSH session ID to SHA-256 of its verified registration. */
    conversationOwners?: Record<string, string>;
}
export interface SignInOptions {
    promptConsent?: boolean;
    retryRegistration?: boolean;
    activateSelectedAccount?: boolean;
}
/** The update callback MUST run exclusively, including its async work, across all processes sharing this record.
 * Implement with ctx.credentials.modifyRecord; use a private grant record and never expose its payload to the UI. */
export interface SecretStore {
    read(): Promise<SiwcState | undefined>;
    modify(update: (current: SiwcState | undefined) => Promise<SiwcState | undefined>): Promise<void>;
}
export interface SiwcOptions {
    store: SecretStore;
    appName: string;
    fetch?: Fetch;
    now?: () => number;
    /** Wrap the verified credential commit (and activation) with the host's turn gate.
     * Invoke commit exactly once and return its result; the store write is atomic. */
    commitSignIn?: <T>(commit: () => Promise<T>) => Promise<T>;
    activateOnSignIn?: boolean;
}
export interface AccountInfo {
    clientId: string;
    subject: string;
    email?: string;
    emailVerified?: boolean;
    signedIn: boolean;
    canUsePlan: boolean;
    expiresAt?: number;
    revocation?: 'confirmed' | 'unconfirmed';
}
export interface SignInAttempt {
    /** One-use loopback navigation capability, containing no credentials. */
    launchUrl: string;
    redirectUri: string;
    /** Settles after callback, failure, timeout or cancellation; result contains no tokens. */
    result: Promise<AccountInfo>;
    cancel(): Promise<void>;
}
/** Safe, structured endpoint error. Never contains the server response body or tokens. */
export declare class SiwcOAuthError extends Error {
    readonly status: number | undefined;
    readonly code: string | undefined;
    readonly operation: 'token' | 'authorization' | 'refresh';
    readonly reauthorizationRequired: boolean;
    /** True means the protected credentials are quarantined; automatic refresh must not be retried. */
    readonly uncertain: boolean;
    constructor(status: number | undefined, code: string | undefined, operation: 'token' | 'authorization' | 'refresh', reauthorizationRequired?: boolean, uncertain?: boolean);
}
export declare function signedIn(a: SiwcAccount): boolean;
export declare function hasUnfinishedRevocation(account: SiwcAccount): boolean;
export declare function hasPendingRegistrationRevocation(state: SiwcState | undefined): boolean;
/** Verify only RS256, the algorithm in OpenAI production discovery; never trust JWT key URLs. */
export declare function verifyIdToken(token: string, clientId: string, nonce: string | undefined, fetcher?: Fetch, now?: number): Promise<{
    subject: string;
    email?: string;
    emailVerified?: boolean;
}>;
export declare class SiwcAuth {
    private readonly fetcher;
    private readonly now;
    private readonly options;
    private revocationEndpoint?;
    constructor(options: SiwcOptions);
    listAccounts(): Promise<AccountInfo[]>;
    private discoverRevocationEndpoint;
    private revoke;
    private host;
    /** Open launchUrl in the system browser. The actual authorization URL and optional
     * id_token_hint are exposed only in the loopback navigation redirect.
     * retryRegistration reuses an unverified pending client solely for a fresh authorization. */
    startSignIn(clientId?: string, timeoutMs?: number, includeIdTokenHint?: boolean, signInOptions?: SignInOptions): Promise<SignInAttempt>;
    private completeSignIn;
    /** Returns a token only to trusted server code, and refuses inference without the granted direct scope.
     * A refresh commits quarantine before network I/O: ambiguous failures freeze the old token.
     * Uncertain grants require explicit reauthorization or sign-out; retrying accessToken never resends them. */
    accessToken(clientId: string, minValidityMs?: number): Promise<string>;
    /** Revoke the selected renewable grant and clear its local credentials. */
    signOut(clientId: string, logoutGeneration?: string): Promise<{
        revoked: boolean;
    }>;
    /** Retry quarantined grants while leaving any usable grant and active registration untouched. */
    retryRevocation(clientId: string): Promise<{
        revoked: boolean;
        hadSession: boolean;
    }>;
    /** Revoke an unverified registration's quarantined tokens without discarding its issued client ID.
     * Keep failed tokens solely for another revocation attempt. Outstanding exchanges and
     * previously unknown sessions can never be reported as confirmed. */
    signOutPending(options?: {
        expectedGeneration?: string;
    }): Promise<{
        revoked: boolean;
        hadSession: boolean;
    }>;
}
export {};
