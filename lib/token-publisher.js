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
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { SiwcOAuthError } from './siwc-auth.js';
import { SiwcServiceError } from './siwc-service.js';
/**
 * The credential reference a profile names as the `openai` route's
 * `apiKeyEnv`. Names are part of the public configuration contract: changing
 * this string silently breaks every profile that names the old one, so it is
 * exported rather than duplicated in the host wiring and the docs.
 */
export const ACCESS_TOKEN_REF = credentialRef('OPENAI_CHATGPT_ACCESS_TOKEN');
/** The environment-variable spelling of {@link ACCESS_TOKEN_REF} for configuration examples. */
export const ACCESS_TOKEN_ENV = 'OPENAI_CHATGPT_ACCESS_TOKEN';
/** How often the publisher rechecks the active account and its token. */
export const PUBLISH_INTERVAL_MS = 20_000;
/** Token validity the publisher asks for, so a refresh happens before the next tick could send an expired bearer. */
export const PUBLISH_MIN_VALIDITY_MS = 5 * 60_000;
/**
 * Keeps one credential reference equal to the active account's access token.
 *
 * Lifecycle: `start()` publishes once and then polls; `stop()` clears the
 * timer. `refresh()` lets a control operation (login completion, account
 * switch, sign-out) publish immediately instead of waiting for the next tick.
 */
export class TokenPublisher {
    credentials;
    service;
    intervalMs;
    minValidityMs;
    ref;
    logger;
    timer;
    lastPublished;
    cleared = false;
    lastWarning;
    running = false;
    stopped = false;
    constructor(options) {
        this.credentials = options.credentials;
        this.service = options.service;
        this.intervalMs = options.intervalMs ?? PUBLISH_INTERVAL_MS;
        this.minValidityMs = options.minValidityMs ?? PUBLISH_MIN_VALIDITY_MS;
        this.ref = options.ref ?? ACCESS_TOKEN_REF;
        this.logger = options.logger;
    }
    /** Begin publishing; safe to call once. */
    start() {
        if (this.timer !== undefined || this.stopped)
            return;
        void this.refresh();
        this.timer = setInterval(() => { void this.refresh(); }, this.intervalMs);
        // A background publisher must never be the reason the host process stays up.
        this.timer.unref?.();
    }
    /** Stop the timer. A publish already in flight is allowed to settle. */
    stop() {
        this.stopped = true;
        if (this.timer !== undefined)
            clearInterval(this.timer);
        this.timer = undefined;
    }
    /**
     * Publish the current token now. Concurrent calls collapse: one publish is
     * enough, and the next tick observes whatever changed meanwhile.
     * @returns after the credential store reflects the current sign-in state.
     */
    async refresh() {
        if (this.running || this.stopped)
            return;
        this.running = true;
        try {
            await this.publish();
        }
        catch (error) {
            // A persistent refusal (an uncertain grant, an issuer outage) would
            // otherwise log on every tick. One line per distinct failure is enough.
            const key = error instanceof Error ? `${error.code ?? ''}:${error.message}` : String(error);
            if (key !== this.lastWarning) {
                this.lastWarning = key;
                this.logger?.warn('dsh-openai-oauth: could not publish the ChatGPT access token', error);
            }
        }
        finally {
            this.running = false;
        }
    }
    /** One reconciliation between the stored grant and the published reference. */
    async publish() {
        const identity = await this.service.getIdentity();
        if (identity === undefined) {
            await this.clear();
            return;
        }
        let token;
        try {
            token = await this.service.getAccessToken(this.minValidityMs);
        }
        catch (error) {
            // A refused or failed refresh is not a sign-out unless the grant itself
            // became unusable. Everything else leaves the last published bearer in
            // place and retries on the next tick.
            if (error instanceof SiwcOAuthError && error.reauthorizationRequired) {
                await this.clear();
                return;
            }
            if (error instanceof SiwcServiceError
                && (error.code === 'MISSING_CREDENTIAL' || error.code === 'LOGOUT_PENDING')) {
                await this.clear();
                return;
            }
            // `refresh_not_ready` and uncertain outcomes keep the current token; a
            // later tick retries once the issuer opens the refresh window.
            throw error;
        }
        if (this.stopped)
            return;
        this.lastWarning = undefined;
        if (token === this.lastPublished)
            return;
        await this.credentials.set(this.ref, token);
        this.lastPublished = token;
        this.cleared = false;
    }
    /**
     * Remove the published reference once no usable account remains. Run once
     * per signed-out period, including on startup: a process that died between
     * clearing its grant and clearing the reference must not leave a dead bearer
     * readable by the provider route.
     */
    async clear() {
        if (this.cleared)
            return;
        await this.credentials.unset(this.ref);
        this.cleared = true;
        this.lastPublished = undefined;
        this.lastWarning = undefined;
    }
}
