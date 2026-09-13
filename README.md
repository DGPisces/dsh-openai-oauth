# dsh-openai-oauth

English | [简体中文](README.zh-CN.md)

Use GPT models from your ChatGPT account as the main model in DeepSeek Harness. Harness keeps its own agent loop and runs its own tools. This package connects its LLM interface to the official local Codex app-server, which handles ChatGPT login, credential storage, token refresh, and model access.

You do not need an OpenAI API key. The package does not copy another Codex installation's `auth.json`, implement its own OAuth client, or call an unpublished ChatGPT endpoint.

## Requirements

- Node.js 22.19 or newer
- DeepSeek Harness developer preview `0.1.0-rc.6`
- A ChatGPT account with Codex access

## Install

Run one command:

```sh
npx -y dsh-openai-oauth install
```

The installer registers the package with the `web` and `headless` profiles, plus any custom profiles that already exist. It also replaces the old `deepseek-harness-openai-oauth` and `dsh-llm-codex-app-server` packages if found.

Run the same command to update the package later. If you create a custom profile after installation, run it once more to register that profile.

## Sign in with ChatGPT

Start the Harness web interface:

```sh
npx @deepseek-ai/dsh web
```

Open **Settings > OpenAI OAuth**, select **Sign in with ChatGPT**, and finish authorization in the OpenAI page. The GPT models available to your account will then appear in the normal Harness model picker.

For a headless profile, sign in from the terminal:

```sh
npx @deepseek-ai/dsh plugin --profile headless exec dsh-codex-login
```

The login is stored separately under `~/.deepseek-harness/codex`. Codex owns the credentials and refreshes them when needed.

## Select a model

Choose the provider and model in the Harness interface, or set them in `~/.dsh/settings.yaml`:

```yaml
agent-default-model:
  provider: openai-codex
  model: gpt-5.6-sol
  reasoningEffort: high
```

Run Harness as usual:

```sh
npx @deepseek-ai/dsh --profile headless "inspect this repository"
```

The plugin reads the model list from the signed-in Codex account. It does not keep a hardcoded list of GPT versions.

## Uninstall

Remove the package from every current Harness profile while keeping the ChatGPT login for a future reinstall:

```sh
npx -y dsh-openai-oauth uninstall
```

For a clean uninstall that also signs out and deletes `~/.deepseek-harness/codex`:

```sh
npx -y dsh-openai-oauth uninstall --purge-auth
```

These commands also remove registrations left by the old package name. They do not install a permanent global npm package. npm may retain its normal download cache.

## Tool permissions

Harness enforces file access and approvals for its dynamic tools. Threads use `environments: []` to disable Codex environment access, removing native file tools such as `apply_patch` instead of relying only on instructions to avoid them. Codex native tools remain in a read-only sandbox; that sandbox does not constrain tools executed by Harness. The adapter explains this boundary in developer instructions so the model follows actual Harness success, denial, or approval results instead of asking users to switch workspaces based on Codex metadata.

Reload the plugin after upgrading so newly created Codex sessions receive the instructions. Already running sessions are not updated automatically.

For an opt-in end-to-end check against an installed Harness runtime, run:

```sh
DSH_CLI=/absolute/path/to/dsh/lib/bin.js node scripts/harness-permission-smoke.mjs
```

This creates isolated Harness homes and workspaces, exercises real `edit` and `read` tools with full-access and read-only policies, checks the durable tool results and file contents, and cleans up the temporary data. It uses the existing plugin ChatGPT login. Set `DSH_SMOKE_PROVIDER` to an installed adapter entry point to verify that installation.

## Local development

```sh
npm install
npm test
npm pack --dry-run
```

This is an independent community plugin. It is not endorsed by DeepSeek or OpenAI.

## License

MIT
