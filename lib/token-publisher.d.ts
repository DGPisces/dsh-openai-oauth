/**
 * Publishes the signed-in ChatGPT account's access token into the harness
 * credential plane, where the configured `llm-pi-ai` route reads it as its
 * API key.
 *
 * This plugin owns no model, session, or transport code. DeepSeek Harness's
 * own provider route serves requests, keeps conversation history, and replays
 * stateless requests to `https://api.openai.com/v1/responses` with
 * `store: false` and `stream: true`. The one fact the harness cannot obtain by
 * itself is who is signed in, which is why this module exists: it keeps the
 * credential reference current while the provider's OAuth grant is renewable,
 * and removes it when the human signs out or the grant stops being usable.
 *
 * The published value is a bearer access token addressed by a normal
 * environment-style credential reference. Writes are idempotent: the store is
 * only touched when the string actually changes, so a stable token does not
 * rewrite `$DSH_HOME/.credentials.yaml` on every tick.
 *
 * @module dsh-openai-oauth/token-publisher
 */
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials';
import { type SiwcService } from './siwc-service.js';
/**
 * The credential reference a profile names as the `openai` route's
 * `apiKeyEnv`. Names are part of the public configuration contract: changing
 * this string silently breaks every profile that names the old one, so it is
 * exported rather than duplicated in the host wiring and the docs.
 */
export declare const ACCESS_TOKEN_REF: CredentialRef;
/** The environment-variable spelling of {@link ACCESS_TOKEN_REF} for configuration examples. */
export declare const ACCESS_TOKEN_ENV = "OPENAI_CHATGPT_ACCESS_TOKEN";
/** How often the publisher rechecks the active account and its token. */
export declare const PUBLISH_INTERVAL_MS = 20000;
/** Token validity the publisher asks for, so a refresh happens before the next tick could send an expired bearer. */
export declare const PUBLISH_MIN_VALIDITY_MS: number;
/** The narrow logger surface this module uses; the Cordis logger satisfies it. */
export interface PublisherLogger {
    /** Report an unexpected refresh failure without leaking tokens. */
    warn(message: string, ...args: unknown[]): void;
}
export interface TokenPublisherOptions {
    /** The harness credential service that stores the published reference. */
    credentials: CredentialProvider;
    /** The SIWC service that owns the grant, account selection, and refresh. */
    service: Pick<SiwcService, 'getIdentity' | 'getAccessToken'>;
    /** Poll interval; defaults to {@link PUBLISH_INTERVAL_MS}. */
    intervalMs?: number;
    /** Validity the publisher asks of a refresh; defaults to {@link PUBLISH_MIN_VALIDITY_MS}. */
    minValidityMs?: number;
    /** Destination reference; defaults to {@link ACCESS_TOKEN_REF}. */
    ref?: CredentialRef;
    /** Optional diagnostic sink. */
    logger?: PublisherLogger;
}
/**
 * Keeps one credential reference equal to the active account's access token.
 *
 * Lifecycle: `start()` publishes once and then polls; `stop()` clears the
 * timer. `refresh()` lets a control operation (login completion, account
 * switch, sign-out) publish immediately instead of waiting for the next tick.
 */
export declare class TokenPublisher {
    private readonly credentials;
    private readonly service;
    private readonly intervalMs;
    private readonly minValidityMs;
    private readonly ref;
    private readonly logger;
    private timer;
    private lastPublished;
    private cleared;
    private lastWarning;
    private running;
    private stopped;
    constructor(options: TokenPublisherOptions);
    /** Begin publishing; safe to call once. */
    start(): void;
    /** Stop the timer. A publish already in flight is allowed to settle. */
    stop(): void;
    /**
     * Publish the current token now. Concurrent calls collapse: one publish is
     * enough, and the next tick observes whatever changed meanwhile.
     * @returns after the credential store reflects the current sign-in state.
     */
    refresh(): Promise<void>;
    /** One reconciliation between the stored grant and the published reference. */
    private publish;
    /**
     * Remove the published reference once no usable account remains. Run once
     * per signed-out period, including on startup: a process that died between
     * clearing its grant and clearing the reference must not leave a dead bearer
     * readable by the provider route.
     */
    private clear;
}
