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
import { SiwcServiceError } from './siwc-service.js';
/** The plugin name whose `openai` route carries the switched credential. */
const PROVIDER_PLUGIN = '@deepseek-ai/dsh-llm-pi-ai';
/** The loader id DSH's own bundles use for that plugin. */
const PROVIDER_ENTRY_ID = 'llm-pi-ai';
/** Whether one loader row is the pi-ai adapter that owns the route. */
function isPiAiEntry(entry) {
    return entry.options.name === PROVIDER_PLUGIN || entry.options.id === PROVIDER_ENTRY_ID;
}
/** The `providers` dict of one layer, or undefined when it has none. */
function providersOf(config) {
    const providers = config?.providers;
    return providers !== null && typeof providers === 'object' && !Array.isArray(providers)
        ? providers
        : undefined;
}
/** One layer's `openai` route, or undefined when it has none. */
function openaiRoute(config) {
    const route = providersOf(config)?.openai;
    return route !== null && typeof route === 'object' && !Array.isArray(route)
        ? route
        : undefined;
}
/**
 * Adapt the DSH configuration editor into the controller's narrow store.
 * @param editor - the mounted configuration service, if this composition has one.
 * @returns the store, or undefined when the profile cannot be edited here.
 */
export function configEditorStore(editor) {
    if (editor === undefined)
        return undefined;
    const findEntry = () => {
        try {
            return editor.entries().find(isPiAiEntry);
        }
        catch {
            return undefined;
        }
    };
    const findRow = () => {
        try {
            return editor.configuration().find(row => isPiAiEntry(row.entry));
        }
        catch {
            return undefined;
        }
    };
    return {
        async currentApiKeyEnv() {
            // The explicit profile layer wins where it states a route; otherwise the
            // route comes from the layer beneath, which the editor reports separately.
            const row = findRow();
            if (row === undefined)
                return undefined;
            // Providers may be split across layers: merge the inherited dict under the
            // explicit one so a route defined only by a bundle layer is still found.
            const route = openaiRoute({
                providers: { ...(providersOf(row.inherited) ?? {}), ...(providersOf(row.override) ?? {}) },
            });
            const ref = route?.apiKeyEnv;
            return typeof ref === 'string' && ref.length > 0 ? ref : undefined;
        },
        async setApiKeyEnv(ref) {
            const entry = findEntry();
            if (entry === undefined) {
                throw new SiwcServiceError('No llm-pi-ai plugin is configured in this profile.', 'NO_OPENAI_ROUTE', 409);
            }
            try {
                await editor.edit(entry, (current, inherited) => {
                    const next = structuredClone(current);
                    const providers = { ...(providersOf(inherited) ?? {}), ...(providersOf(current) ?? {}) };
                    const route = openaiRoute({ providers });
                    if (route === undefined) {
                        throw new SiwcServiceError('The profile has no "openai" provider route to switch; add one in Settings > Models.', 'NO_OPENAI_ROUTE', 409);
                    }
                    next.providers = { ...providers, openai: { ...route, apiKeyEnv: ref } };
                    return next;
                });
            }
            catch (error) {
                if (error instanceof SiwcServiceError)
                    throw error;
                throw new SiwcServiceError('The provider route could not be updated; check that the profile is writable and rerun the switch.', 'CONFIG_WRITE_FAILED', 409);
            }
        },
    };
}
