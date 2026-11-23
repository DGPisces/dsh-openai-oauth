/**
 * Local control API for the OpenAI OAuth settings surface.
 *
 * The route is deliberately small: it starts and cancels a sign-in, lists and
 * selects saved registrations, reports status, exposes the signed-in account's
 * model catalog for display, and signs out. Inference, conversation history,
 * and model selection are not here — DeepSeek Harness's provider settings and
 * agent loop own them.
 *
 * @module dsh-openai-oauth/oauth-http
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { AuthModeController } from './auth-mode.js';
import { type SiwcService } from './siwc-service.js';
/** The browser's signed session is admitted by DSH, using the same policy as its own API. */
export interface OAuthConnection {
    readonly browserPeer: object;
    admit(request: Pick<IncomingMessage, 'headers'>): {
        peer: object;
    } | {
        rejection: 401 | 403;
    };
}
interface OAuthRouteOptions {
    connection: OAuthConnection;
    protocol: 'http:' | 'https:';
    /** Optional authentication-mode switch; absent when this profile cannot be edited. */
    authMode?: AuthModeController;
    /**
     * Called after a request that may have changed the sign-in state, so the
     * host can republish the credential reference immediately instead of waiting
     * for its next poll.
     */
    afterMutation?: () => void;
}
export declare function handleOAuthRequest(service: Pick<SiwcService, 'status' | 'login' | 'cancelLogin' | 'logout' | 'listAccounts' | 'selectAccount' | 'listModelCatalog' | 'acknowledgeWelcome'>, req: IncomingMessage, res: ServerResponse, options: OAuthRouteOptions): Promise<void>;
export declare function oauthRoute(service: SiwcService, options: OAuthRouteOptions): WebRoute;
export {};
