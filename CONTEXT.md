# dsh-openai-oauth

Sign in with ChatGPT for DeepSeek Harness. The plugin is a **login plugin**:
it obtains and renews a ChatGPT-plan OAuth grant and publishes the active
access token; the harness provider route serves inference.

## Language

**SIWC grant**:
The user-authorized Sign in with ChatGPT registration, stored as a private
credential record owned by this plugin (`grant` payload). Holds account
mapping and renewable tokens; never returned to the browser.
_Avoid_: API key, Codex login, copied token

**Access-token reference**:
The ordinary credential reference `OPENAI_CHATGPT_ACCESS_TOKEN` that the
configured `llm-pi-ai` route reads through `apiKeyEnv`. The plugin republishes
it when the token rotates and removes it on sign-out.
_Avoid_: provider config secret, env file

**Provider route**:
The `llm-pi-ai` entry named `openai` with `apiKeyEnv:
OPENAI_CHATGPT_ACCESS_TOKEN`. It must keep that name: pi-ai only applies the
Sign in with ChatGPT request shape (public Responses endpoint, `store: false`,
`stream: true`, unsupported fields omitted) under this provider.
_Avoid_: Codex route, openai-codex, app-server

**Authentication mode**:
Which credential the `openai` route reads: the published plan token
(`authMode: plan`) or the stored API key (`authMode: api`). The switch rewrites
only that route's `apiKeyEnv` through the profile configuration editor; models
and other providers are untouched.
_Avoid_: second route, provider rename, duplicated key

**Harness-owned behavior**:
Everything after sign-in: model catalog, conversation history and compaction,
tool calls, images, streaming, retries, error classification, and usage
surfacing. The plugin registers no LLM adapter and no session state.
_Avoid_: plugin adapter, thread binding, conversation ownership
