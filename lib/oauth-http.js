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
import { isIP } from 'node:net';
import { SiwcOAuthError } from './siwc-auth.js';
import { SiwcServiceError } from './siwc-service.js';
const PATH = '/api/openai-oauth';
function loopback(address) {
    if (!address)
        return false;
    if (address === '::1')
        return true;
    const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address;
    return isIP(ipv4) === 4 && ipv4.startsWith('127.');
}
function trusted(req, protocol) {
    if (!loopback(req.socket.remoteAddress) || typeof req.headers.host !== 'string')
        return false;
    let authority;
    try {
        authority = new URL(`${protocol}//${req.headers.host}`);
    }
    catch {
        return false;
    }
    // Reject credentials, paths, fragments and malformed authorities.
    if (authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash || authority.host !== req.headers.host.toLowerCase())
        return false;
    const hostname = authority.hostname.replace(/^\[|\]$/g, '');
    if (hostname !== 'localhost' && hostname !== '::1' && !(isIP(hostname) === 4 && hostname.startsWith('127.')))
        return false;
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite !== undefined && fetchSite !== 'same-origin')
        return false;
    const origin = req.headers.origin;
    if (req.method === 'POST' && typeof origin !== 'string')
        return false;
    if (origin !== undefined) {
        try {
            if (new URL(origin).origin !== authority.origin || origin !== authority.origin)
                return false;
        }
        catch {
            return false;
        }
    }
    return true;
}
function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    res.end(JSON.stringify(body));
}
async function body(req) {
    let text = '';
    for await (const chunk of req) {
        text += Buffer.from(chunk).toString('utf8');
        if (Buffer.byteLength(text) > 65_536)
            throw new SiwcServiceError('Request body is too large.', 'INVALID_REQUEST', 400);
    }
    if (!text)
        return {};
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            return parsed;
    }
    catch { }
    throw new SiwcServiceError('Invalid request.', 'INVALID_REQUEST', 400);
}
export async function handleOAuthRequest(service, req, res, options) {
    const { connection, protocol, authMode, afterMutation } = options;
    if (!trusted(req, protocol))
        return json(res, 403, { error: 'OAuth controls are available only from the local Harness UI.' });
    let admission;
    try {
        admission = connection.admit(req);
    }
    catch {
        return json(res, 503, { error: 'Harness Web authentication is unavailable.', code: 'HARNESS_AUTH_UNAVAILABLE' });
    }
    if ('rejection' in admission) {
        return json(res, admission.rejection, { error: 'Open the authenticated Harness Web UI to manage OAuth.', code: 'HARNESS_AUTH_REQUIRED' });
    }
    if (admission.peer !== connection.browserPeer) {
        return json(res, 403, { error: 'OAuth controls require a Harness browser session.', code: 'HARNESS_AUTH_REQUIRED' });
    }
    let url;
    try {
        url = new URL(req.url ?? '/', 'http://localhost');
        if (url.origin !== 'http://localhost')
            return json(res, 400, { error: 'Invalid request.' });
    }
    catch {
        return json(res, 400, { error: 'Invalid request.' });
    }
    const path = url.pathname;
    /** Answer one request; a state-changing answer also offers the host a republish. */
    const answer = (status, value) => {
        if (req.method === 'POST')
            afterMutation?.();
        json(res, status, value);
    };
    try {
        if (req.method === 'GET' && path === `${PATH}/status`)
            return json(res, 200, await service.status({ light: url.searchParams.get('light') === '1' }));
        if (req.method === 'GET' && path === `${PATH}/accounts`)
            return json(res, 200, { accounts: await service.listAccounts() });
        if (req.method === 'GET' && path === `${PATH}/models`)
            return json(res, 200, await service.listModelCatalog());
        if (req.method === 'GET' && path === `${PATH}/auth-mode`) {
            if (authMode === undefined) {
                return json(res, 200, { mode: 'missing', apiKeyAvailable: false, signedIn: false, canSwitch: false });
            }
            return json(res, 200, await authMode.state());
        }
        if (req.method === 'POST' && path === `${PATH}/auth-mode`) {
            if (authMode === undefined) {
                throw new SiwcServiceError('This deployment cannot change the provider route from here.', 'NO_CONFIG_EDITOR', 409);
            }
            const input = await body(req);
            if (input.mode !== 'plan' && input.mode !== 'api') {
                throw new SiwcServiceError('Choose ChatGPT plan or OpenAI API key.', 'INVALID_MODE', 400);
            }
            return answer(200, await authMode.switch(input.mode));
        }
        if (req.method === 'POST' && path === `${PATH}/welcome/ack`) {
            const input = await body(req);
            if (typeof input.clientId !== 'string' || !input.clientId || typeof input.subject !== 'string' || !input.subject) {
                throw new SiwcServiceError('Invalid request.', 'INVALID_REQUEST', 400);
            }
            return answer(200, await service.acknowledgeWelcome(input.clientId, input.subject));
        }
        if (req.method === 'POST' && path === `${PATH}/login`) {
            const input = await body(req);
            if (input.clientId !== undefined && (typeof input.clientId !== 'string' || !input.clientId)
                || input.newAccount !== undefined && typeof input.newAccount !== 'boolean'
                || input.retryRegistration !== undefined && typeof input.retryRegistration !== 'boolean'
                || input.enablePlan !== undefined && typeof input.enablePlan !== 'boolean') {
                throw new SiwcServiceError('Invalid request.', 'INVALID_REQUEST', 400);
            }
            return answer(200, await service.login({
                clientId: input.clientId,
                newAccount: input.newAccount,
                retryRegistration: input.retryRegistration,
                enablePlan: input.enablePlan,
            }));
        }
        if (req.method === 'POST' && path === `${PATH}/login/cancel`)
            return answer(200, await service.cancelLogin());
        if (req.method === 'POST' && path === `${PATH}/accounts/select`) {
            const input = await body(req);
            if (typeof input.clientId !== 'string' || !input.clientId)
                throw new SiwcServiceError('Invalid request.', 'INVALID_REQUEST', 400);
            return answer(200, await service.selectAccount(input.clientId));
        }
        if (req.method === 'POST' && path === `${PATH}/logout`) {
            const input = await body(req);
            const { pendingOnly } = input;
            if (pendingOnly !== undefined && typeof pendingOnly !== 'boolean') {
                throw new SiwcServiceError('Invalid request.', 'INVALID_REQUEST', 400);
            }
            return answer(200, await service.logout(pendingOnly === undefined ? undefined : { pendingOnly }));
        }
        return json(res, 404, { error: 'Not found.' });
    }
    catch (error) {
        if (error instanceof SiwcOAuthError && error.code === 'refresh_not_ready') {
            return json(res, 503, { error: 'OpenAI has not opened the refresh window for this authorization.', code: 'REFRESH_NOT_READY' });
        }
        if (error instanceof SiwcServiceError) {
            const messages = {
                INVALID_REQUEST: 'Invalid request.', LOGIN_PENDING: 'Sign-in is already pending.', LOGOUT_PENDING: 'Sign-out is in progress.',
                LOGIN_FAILED: 'Sign-in could not be started.', LOGIN_CANCELLED: 'Sign-in was cancelled.', ACCOUNT_UNAVAILABLE: 'Saved account is unavailable.',
                ACCOUNT_SWITCH_UNAVAILABLE: 'Account switching is not available yet.', ACCOUNT_CHANGE_UNAVAILABLE: 'Account change is unavailable.',
                PLAN_NOT_ENABLED: 'ChatGPT plan permission is not enabled.',
                INVALID_MODE: 'Choose ChatGPT plan or OpenAI API key.',
                NO_CONFIG_EDITOR: 'This deployment cannot change the provider route from here.',
                NO_OPENAI_ROUTE: 'The profile has no "openai" provider route to switch.',
                API_KEY_MISSING: 'No OpenAI API key is stored under OPENAI_API_KEY.',
                CONFIG_WRITE_FAILED: 'The provider route could not be updated.',
            };
            return json(res, error.status >= 400 && error.status <= 599 ? error.status : 500, { error: messages[error.code] ?? 'OAuth request failed.', code: /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'OAUTH_ERROR' });
        }
        return json(res, 500, { error: 'OAuth request failed.' });
    }
}
export function oauthRoute(service, options) {
    return { kind: 'prefix', path: PATH, handler: (req, res) => handleOAuthRequest(service, req, res, options) };
}
