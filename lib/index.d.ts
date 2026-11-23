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
import type { Context } from '@deepseek-ai/cordis';
import type { CredentialKey, CredentialProvider } from '@deepseek-ai/dsh-credentials';
import z from '@deepseek-ai/schemastery';
import { type SecretStore } from './siwc-auth.js';
/** The registered plugin name; it also scopes the private OAuth grant record. */
export declare const name = "llm-codex-app-server";
export declare const inject: string[];
/** One model an older profile may still declare for the retired adapter. */
export interface ConfiguredModel {
    id: string;
    name?: string;
    description?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: readonly ('text' | 'image')[];
    reasoningEfforts?: readonly string[];
    defaultReasoningEffort?: string;
}
/**
 * Configuration accepted for profiles written against the adapter-era plugin.
 * Both fields are inert now: models are chosen in Settings > Models, and the
 * transport belongs to the harness provider route. Keeping the keys accepted
 * lets an existing profile upgrade without a hand edit.
 */
export interface Config {
    /** @deprecated Ignored; inference is served by the harness provider route. */
    responsesTransport?: 'direct' | 'bridge';
    /** @deprecated Ignored; select models in Settings > Models instead. */
    models?: readonly ConfiguredModel[] | {
        get(): readonly ConfiguredModel[];
    };
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    responsesTransport: z<"direct" | "bridge", "direct" | "bridge", "defined">;
    models: z<NoInfer<({
        id?: string | null | undefined;
        name?: string | null | undefined;
        description?: string | null | undefined;
        contextWindow?: number | null | undefined;
        maxTokens?: number | null | undefined;
        input?: ("text" | "image")[] | null | undefined;
        reasoningEfforts?: string[] | null | undefined;
        defaultReasoningEffort?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "defined">;
        name: z<string, string, "plain">;
        description: z<string, string, "plain">;
        contextWindow: z<number, number, "plain">;
        maxTokens: z<number, number, "plain">;
        input: z<("text" | "image")[], ("text" | "image")[], "defined">;
        reasoningEfforts: z<string[], string[], "plain">;
        defaultReasoningEffort: z<string, string, "plain">;
    }>>[]>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    responsesTransport: z<"direct" | "bridge", "direct" | "bridge", "defined">;
    models: z<NoInfer<({
        id?: string | null | undefined;
        name?: string | null | undefined;
        description?: string | null | undefined;
        contextWindow?: number | null | undefined;
        maxTokens?: number | null | undefined;
        input?: ("text" | "image")[] | null | undefined;
        reasoningEfforts?: string[] | null | undefined;
        defaultReasoningEffort?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "defined">;
        name: z<string, string, "plain">;
        description: z<string, string, "plain">;
        contextWindow: z<number, number, "plain">;
        maxTokens: z<number, number, "plain">;
        input: z<("text" | "image")[], ("text" | "image")[], "defined">;
        reasoningEfforts: z<string[], string[], "plain">;
        defaultReasoningEffort: z<string, string, "plain">;
    }>>[]>, "volatile-defined">;
}>>, "plain">;
/**
 * Adapt the harness credential seam to the auth module's store: one grant
 * record owned by this plugin keeps the authorization out of configuration,
 * and `modifyRecord` supplies the cross-process exclusion token refresh needs.
 * @param credentials - the harness credential service.
 * @param key - this plugin's record address.
 * @returns the durable secret store used by the authentication module.
 */
export declare function credentialStore(credentials: CredentialProvider, key: CredentialKey): SecretStore;
export declare function apply(ctx: Context): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
