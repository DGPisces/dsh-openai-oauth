/**
 * `dsh-openai-oauth`: Sign in with ChatGPT for DeepSeek Harness.
 *
 * The plugin owns the OAuth conversation that obtains a ChatGPT-plan grant and
 * keeps the harness credential reference that a normal provider route reads.
 * Everything a request needs after sign-in — model catalog, session history,
 * streaming, tool calls, images, retries, error classification — belongs to
 * DeepSeek Harness and its `llm-pi-ai` adapter. The plugin registers no model
 * adapter and no session machinery of its own.
 *
 * Wiring a profile therefore has two halves:
 *
 * 1. this plugin, which signs in and publishes `OPENAI_CHATGPT_ACCESS_TOKEN`;
 * 2. an `llm-pi-ai` route named `openai` (the route name matters: the adapter
 *    only recognizes Sign in with ChatGPT plan requests under that provider)
 *    whose `apiKeyEnv` is that reference.
 *
 * The settings page can switch that route's `apiKeyEnv` between the plan token
 * and the deployment's stored `OPENAI_API_KEY`, so one route serves either
 * authentication and the API key stays available for billing-backed use.
 *
 * ```yaml
 * - id: llm-pi-ai
 *   config:
 *     providers:
 *       openai:
 *         apiKeyEnv: OPENAI_CHATGPT_ACCESS_TOKEN
 *         models:
 *           - id: gpt-6.2-sol
 *           - id: gpt-6.1-terra
 * ```
 *
 * @module dsh-openai-oauth
 */
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import z from '@deepseek-ai/schemastery';
import { AuthModeController } from './auth-mode.js';
import { oauthRoute } from './oauth-http.js';
import { configEditorStore } from './route-config.js';
import { SiwcService } from './siwc-service.js';
import { SIWC_AGENT_NAME } from './siwc-auth.js';
import { TokenPublisher } from './token-publisher.js';
/** The registered plugin name; it also scopes the private OAuth grant record. */
export const name = 'llm-codex-app-server';
export const inject = ['credentials'];
export const Config = z.object({
    responsesTransport: z.union(['direct', 'bridge']).default('direct'),
    models: z.array(z.object({
        id: z.string().required(),
        name: z.string(),
        description: z.string(),
        contextWindow: z.number(),
        maxTokens: z.number(),
        input: z.array(z.union(['text', 'image'])).default(['text', 'image']),
        reasoningEfforts: z.array(z.string()),
        defaultReasoningEffort: z.string(),
    })).default([]).volatile(),
});
function isSiwcState(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const state = value;
    return typeof state.hostId === 'string' && state.hostId.length > 0 && Array.isArray(state.accounts);
}
/**
 * Adapt the harness credential seam to the auth module's store: one grant
 * record owned by this plugin keeps the authorization out of configuration,
 * and `modifyRecord` supplies the cross-process exclusion token refresh needs.
 * @param credentials - the harness credential service.
 * @param key - this plugin's record address.
 * @returns the durable secret store used by the authentication module.
 */
export function credentialStore(credentials, key) {
    const stateOf = (record) => {
        if (record === undefined)
            return undefined;
        if (record.kind !== 'grant' || !isSiwcState(record.payload)) {
            throw new Error('Stored OpenAI authorization is unreadable or was written by another plugin. Sign in again in Settings > OpenAI OAuth.');
        }
        return record.payload;
    };
    return {
        async read() {
            return stateOf(await credentials.readRecord(key));
        },
        async modify(update) {
            await credentials.modifyRecord(key, async (current) => {
                const next = await update(stateOf(current));
                if (next === undefined)
                    return undefined;
                // The credential document is strict JSON: optional fields the auth
                // module represents as `undefined` must become absent, not a rejected
                // write. A round trip is also what a later read would see.
                return { kind: 'grant', payload: JSON.parse(JSON.stringify(next)) };
            });
        },
    };
}
export function apply(ctx) {
    const store = credentialStore(ctx.credentials, credentialKey(name, 'siwc'));
    const service = new SiwcService(store, {
        appName: SIWC_AGENT_NAME,
        // This plugin no longer owns a turn, so account changes and catalog reads
        // no longer have a provider-side turn gate to respect. The service still
        // serializes its own login/logout operations through its queue.
        withAccountChange: change => change(),
        withAccountRead: read => read(),
    });
    const authMode = new AuthModeController({
        store: configEditorStore(ctx.get('configEditor')),
        credentials: ctx.credentials,
        service,
        logger: ctx.logger,
    });
    const publisher = new TokenPublisher({
        credentials: ctx.credentials,
        service,
        logger: ctx.logger,
    });
    ctx.effect(() => {
        publisher.start();
        return async () => {
            publisher.stop();
            await service.close();
        };
    }, 'llm-codex-app-server.tokens');
    ctx.inject(['webServer', 'connection'], webCtx => {
        const connection = webCtx.get('connection');
        webCtx.effect(() => webCtx.webServer.register(oauthRoute(service, {
            connection,
            protocol: webCtx.webServer.protocol,
            authMode,
            // A sign-in, account switch, or sign-out must reach the provider route
            // without waiting for the next publish tick.
            afterMutation: () => { void publisher.refresh(); },
        })), 'llm-codex-app-server.oauth-route');
    });
}
export default { name, inject, apply };
