# dsh-openai-oauth

English | [简体中文](README.zh-CN.md)

Sign in with ChatGPT for DeepSeek Harness through OpenAI's official **Sign in with ChatGPT (SIWC)** flow.

The plugin does one job: it runs the OAuth conversation that registers this installation, verifies the ID token, and keeps a harness credential reference named `OPENAI_CHATGPT_ACCESS_TOKEN` equal to the signed-in account's current access token. It can also switch the `openai` provider route between that plan token and an ordinary OpenAI API key (`OPENAI_API_KEY`) from the settings page. Everything else belongs to DeepSeek Harness:

- the `llm-pi-ai` provider route serves every model request;
- the agent loop owns conversation history, compaction, tool calls, and images;
- streaming, retries, and error classification come from the harness provider adapter.

The plugin registers no model adapter, no transport, and no session machinery of its own.

## Requirements

- Node.js 22.19 or newer
- DeepSeek Harness `0.2.2-rc.5` (or a later 0.2 release)
- A ChatGPT account eligible for SIWC ChatGPT plan usage, and your consent in the browser
- A local browser for the authorization round trip (loopback callback)

## Install

```sh
npx -y dsh-openai-oauth install
```

The installer registers the package with the `web` and `headless` profiles, plus any custom profiles that already exist, and replaces the old `deepseek-harness-openai-oauth` and `dsh-llm-codex-app-server` packages if found. Run it again to update or to add a profile created later.

## Configure the provider route

The plugin publishes a credential; a normal `llm-pi-ai` route consumes it. Add this route to the profile's `cordis.patch.yml` once:

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      openai:
        apiKeyEnv: OPENAI_CHATGPT_ACCESS_TOKEN
        models:
          - id: gpt-6.2-sol
            name: GPT-6.2 Sol
            contextWindow: 500000
            maxTokens: 128000
            input: [text, image]
          - id: gpt-6.1-terra
            name: GPT-6.1 Terra
            contextWindow: 500000
            maxTokens: 128000
            input: [text, image]
```

The route must be named `openai`. The pi-ai adapter only recognizes Sign in with ChatGPT plan requests under that provider: it sends them to `https://api.openai.com/v1/responses` with `store: false` and `stream: true`, and omits the request fields the plan flow rejects. A route under any other name would use the wrong endpoint and request shape.

The model ids are the ones your account exposes through `GET https://api.openai.com/v1/models` (entries whose `visibility` is `list`). Signed-in users can read that list in **Settings → OpenAI OAuth**. DeepSeek Harness's installed pi-ai catalog already describes the current plan models, so `id` alone inherits their capabilities; the entries above only pin the account-visible choices and capacities.

Your own edits to the profile are preserved: a Cordis config override replaces the whole `llm-pi-ai` entry, so keep any other providers you configured in the same block.

## Switch between ChatGPT plan and an OpenAI API key

The same `openai` route serves one authentication at a time. **Settings → OpenAI OAuth** shows the current choice and switches the route's `apiKeyEnv` between:

- **ChatGPT plan** — `OPENAI_CHATGPT_ACCESS_TOKEN`, the token this plugin publishes; requests use the subscription.
- **OpenAI API key** — `OPENAI_API_KEY`, a key you stored in the Models page; requests are billed to the API account.

Switching rewrites only that one field in the profile's `llm-pi-ai` configuration; models and other providers stay as they are, and the change takes effect on the next request without a restart. API mode is refused while no API key is stored; plan mode can be selected while signed out, but plan requests only work after signing in. The two modes share the route's model list, so use model ids both accounts serve.

## Sign in with ChatGPT

Open the Harness web interface and go to **Settings → OpenAI OAuth**:

```sh
npx @deepseek-ai/dsh web
```

Open the Web URL printed by DSH to establish its browser session. The account and model controls require that authenticated local session. Read the privacy notice and select **Continue with ChatGPT**. The plugin starts a one-time loopback listener, then opens OpenAI's authorization page. Review the requested access there. The `chatgpt.tokens.use.direct` permission allows plan usage. Returning to Harness, the settings page shows the signed-in account, whether plan usage is authorized, and the account's model catalog.

To activate a saved account, choose **Authorize and switch to this account**. Harness repeats OAuth using that account's existing registration and switches after validating the result. The current account stays active if the authorization is cancelled or fails validation.

Signing out revokes the renewable session with OpenAI when possible. If revocation cannot be confirmed, Harness still clears the local tokens and says so; you can also disconnect the app in ChatGPT settings. A pending authorization can be stopped from the settings page; that cancels the local attempt so another sign-in can start immediately.

Headless profiles use the same Harness credential store (`~/.dsh/.credentials.yaml` by default, owner-only). Sign in once through the web UI; `headless` then reads the stored grant. There is no terminal login command.

### Where credentials live

The authorization grant is stored as a DSH credential record, not in `cordis.patch.yml` or any plugin configuration. Only your OS user can read the credential file. Access, refresh, and ID tokens stay on the Host: they are never returned to the settings page, written to logs, or placed in browser storage. The access token is also published under the `OPENAI_CHATGPT_ACCESS_TOKEN` reference in the same credential store, because that is how the provider route reads it; it is republished when the token rotates and removed on sign-out. A host identifier and account/client mapping are retained after sign-out so a later sign-in can reuse the issued client; tokens are not.

### Privacy and data handling

New authorizations identify this independent plugin as `dsh-openai-oauth`. Existing registrations keep their issued client IDs. The local account mapping includes the verified account identifier, the email when OpenAI supplies it, and the registration ID. Signing out clears that account's usable credentials and retains the mapping for returning sign-in. Manage authorization and plan limits in [ChatGPT Settings](https://chatgpt.com/settings/usage).

Inference is performed by the harness provider route you configured, not by this plugin. When that route is selected, the request, its conversation context, and any retained input images go to OpenAI for inference. Any harness request that selects the route uses the plan — including automatic titles, scheduled deliveries, and automatic goal rounds. Choose a different default model when a request should not use it. Use the grant only in a runtime you control for your own requests. [OpenAI privacy policy](https://openai.com/policies/privacy-policy/) · [Sign in with ChatGPT terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)

## Models

The DSH model picker shows whatever the configured `openai` route declares. The plugin lists the signed-in account's live catalog in **Settings → OpenAI OAuth** so you can copy model ids; selection itself belongs to **Settings → Models**, which owns every provider route.

## Generation limits

The plan flow rejects `max_output_tokens`, so a route-level `maxTokens` is not sent as an output cap; the account's own limit applies. The harness still records and displays token usage. Context compaction, when enabled for the conversation, is performed by the harness against the same route.

## Usage and quotas

ChatGPT plan usage is subject to OpenAI's limits and is shared with other apps that use your plan. A usage-limit failure arrives as a normal harness provider error, naming the affected request. [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage)

## Troubleshooting

- **`MISSING_CREDENTIAL`**: nothing is signed in, so the route's `apiKeyEnv` reference is unset. Sign in in **Settings → OpenAI OAuth**.
- **Plan usage disabled**: the grant is valid but lacks `chatgpt.tokens.use.direct`. Choose to authorize plan usage again and approve it on OpenAI's page.
- **Quota or eligibility errors**: check ChatGPT usage and the account/workspace policy. The plugin does not retry the same ineligible request in a loop.
- **Authorization revoked**: sign in again. Harness stops using an invalid token rather than retrying it.
- **Temporary refresh failure**: the plugin quarantines the authorization instead of reusing a possibly rotated refresh token. Your account mapping is kept; sign in again to resume.
- **Model list empty in the picker**: check that the profile declares the `openai` route with `apiKeyEnv: OPENAI_CHATGPT_ACCESS_TOKEN`, then save the provider in **Settings → Models**.

## Uninstall

```sh
npx -y dsh-openai-oauth uninstall
```

This removes the package from every current profile and preserves credentials so a reinstall can reuse the account mapping. Sign out in Settings first if you want to revoke the session. There is no `--purge-auth` option: the plugin never deletes arbitrary credential or Codex directories. Existing Codex CLI data is untouched.

## Preview limitations

SIWC is in preview. OpenAI may change endpoints, scopes, or eligibility rules. If OpenAI changes the flow, expect to sign in again.

## Known limitations

- **No per-conversation account binding.** The plugin no longer tracks which account started a conversation; the harness replays the conversation's history to whichever account is signed in when the next request runs. Switching accounts therefore continues existing conversations under the new account, and their retained context is sent to it. Sign out instead of switching when a conversation must not move.
- OpenAI's current SIWC plan flow indicates disconnection on a later request or refresh. If a request or refresh confirms that the authorization is invalid, sign in again.
- This loopback installation does not receive account security notifications through OIDC Back-Channel Logout. That integration needs a publicly reachable HTTPS endpoint. [OpenAI account security notifications](https://developers.openai.com/siwc/account-security-notification)
- The published access token is refreshed on a timer with a five-minute margin. A process that stays suspended longer than its refresh window can serve one expired bearer before the next publish; the resulting request fails visibly and a retry uses the refreshed token.

## Local development

```sh
npm install
npm test
npm pack --dry-run
```

This is an independent community plugin. It is not endorsed by DeepSeek or OpenAI.

## License

MIT
