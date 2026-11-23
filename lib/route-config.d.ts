/**
 * Host-side bridge from the authentication-mode controller to the profile
 * configuration editor.
 *
 * The route this plugin switches belongs to `llm-pi-ai`, not to this plugin,
 * so the accessor is deliberately narrow: read that one route's `apiKeyEnv`
 * and replace just that field while every other provider and setting stays
 * untouched. Writing goes through DSH's configuration editor, which serializes
 * the edit with Loader reloads and reverts a failed reconciliation.
 *
 * @module dsh-openai-oauth/route-config
 */
import type { AuthModeStore } from './auth-mode.js';
/** Structural view of one loader entry; only the fields this module reads. */
interface ConfigEntryLike {
    options: {
        id: string;
        name?: string;
    };
}
/** Structural view of the parts of `ctx.configEditor` this module calls. */
export interface ConfigEditorLike {
    entries(): readonly ConfigEntryLike[];
    configuration(): ReadonlyArray<{
        entry: ConfigEntryLike;
        inherited: Record<string, unknown>;
        override: Record<string, unknown>;
    }>;
    edit(entry: never, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}
/**
 * Adapt the DSH configuration editor into the controller's narrow store.
 * @param editor - the mounted configuration service, if this composition has one.
 * @returns the store, or undefined when the profile cannot be edited here.
 */
export declare function configEditorStore(editor: ConfigEditorLike | undefined): AuthModeStore | undefined;
export {};
