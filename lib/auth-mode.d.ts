/**
 * Authentication-mode switching for the configured `openai` provider route.
 *
 * One route can authenticate a request two ways, and pi-ai decides which by
 * the credential it receives: a `sk-` API key takes the ordinary OpenAI API
 * path, while a ChatGPT access token takes the Sign in with ChatGPT plan path.
 * Because the route reads exactly one credential reference, switching modes
 * means pointing that route at the other reference:
 *
 * - `plan` → {@link PLAN_REF}, published by this plugin from the signed-in
 *   ChatGPT account;
 * - `api`  → {@link API_REF}, the API key the deployment already stored.
 *
 * This module owns the decision and the checks; it reaches the profile only
 * through {@link AuthModeStore}, so the Cordis-specific configuration editing
 * stays in the host wiring and the controller is testable on its own.
 *
 * @module dsh-openai-oauth/auth-mode
 */
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { type SiwcService } from './siwc-service.js';
/** The credential reference that carries the ChatGPT plan access token. */
export declare const PLAN_REF = "OPENAI_CHATGPT_ACCESS_TOKEN";
/** The credential reference that carries the OpenAI API key. */
export declare const API_REF = "OPENAI_API_KEY";
/** Which authentication a request on the `openai` route uses. */
export type AuthMode = 'plan' | 'api';
/**
 * The route's credential reference, seen as a value this plugin may read and
 * replace. `undefined` from {@link currentApiKeyEnv} means the profile has no
 * `openai` route to switch.
 */
export interface AuthModeStore {
    /** @returns the route's configured `apiKeyEnv`, when the route exists. */
    currentApiKeyEnv(): Promise<string | undefined>;
    /**
     * Replace the route's `apiKeyEnv`, preserving every other route field.
     * @param ref - the reference the route should read.
     */
    setApiKeyEnv(ref: string): Promise<void>;
}
/** What the settings surface renders about the current authentication. */
export interface AuthModeState {
    /** `missing` means the profile has no `openai` route; `other` means it names an unrecognized reference. */
    mode: AuthMode | 'other' | 'missing';
    /** Whether {@link API_REF} currently resolves to a stored value. */
    apiKeyAvailable: boolean;
    /** Whether a ChatGPT account is signed in for plan usage. */
    signedIn: boolean;
    /** Whether this composition can change the route at all. */
    canSwitch: boolean;
}
/** The logger surface used here; the Cordis logger satisfies it. */
export interface AuthModeLogger {
    /** Record an unexpected configuration write failure. */
    warn(message: string, ...args: unknown[]): void;
}
export interface AuthModeControllerOptions {
    /** Configuration access; absent when this composition has no profile editor. */
    store?: AuthModeStore;
    /** Credential seam used to see whether the API key exists. */
    credentials: CredentialProvider;
    /** The sign-in service, for the plan-side state. */
    service: Pick<SiwcService, 'getIdentity'>;
    /** Optional diagnostic sink. */
    logger?: AuthModeLogger;
}
/**
 * Reads and switches which credential the `openai` route authenticates with.
 *
 * Switching changes no model, no session, and no request in flight: the next
 * request after the configuration reload resolves the newly named reference.
 */
export declare class AuthModeController {
    private readonly store;
    private readonly credentials;
    private readonly service;
    constructor(options: AuthModeControllerOptions);
    /**
     * Report the route's current mode and what could change it.
     * @returns the state the settings surface renders.
     */
    state(): Promise<AuthModeState>;
    /**
     * Point the route at one authentication mode.
     * @param mode - the mode to activate.
     * @returns the state after the change.
     * @throws {SiwcServiceError} `NO_CONFIG_EDITOR` when nothing can edit the profile,
     *   `NO_OPENAI_ROUTE` when the profile has no `openai` route,
     *   `API_KEY_MISSING` when the API key is not stored, `INVALID_MODE` otherwise.
     */
    switch(mode: AuthMode): Promise<AuthModeState>;
    /** Whether the API-key reference resolves to a stored value right now. */
    private hasApiKey;
}
