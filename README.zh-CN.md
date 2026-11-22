# dsh-openai-oauth

[English](README.md) | 简体中文

通过 OpenAI 官方 **Sign in with ChatGPT（SIWC）** 流程，为 DeepSeek Harness 连接 ChatGPT 订阅。

插件只做一件事：完成 OAuth 登录、验证 ID token，并把当前账户的访问令牌持续发布到名为 `OPENAI_CHATGPT_ACCESS_TOKEN` 的 Harness 凭据引用中；同时可在设置页把 `openai` 提供方路由在套餐令牌与普通 OpenAI API key（`OPENAI_API_KEY`）之间切换。其余全部交给 DeepSeek Harness：

- `llm-pi-ai` 提供方路由负责所有模型请求；
- agent loop 负责会话历史、压缩、工具调用与图片；
- 流式输出、重试与错误分类由 Harness 的提供方适配器负责。

插件不再注册模型适配器、传输层或会话管理代码。

## 环境要求

- Node.js 22.19 或更高版本
- DeepSeek Harness `0.2.2-rc.5`（或更新的 0.2 版本）
- 具备 SIWC ChatGPT 套餐使用资格的 ChatGPT 账户，并在浏览器中完成授权
- 用于回调的本机浏览器（loopback）

## 安装

```sh
npx -y dsh-openai-oauth install
```

安装器会把插件注册到 `web` 与 `headless` 配置，以及已存在的自定义配置，并在发现旧包 `deepseek-harness-openai-oauth`、`dsh-llm-codex-app-server` 时替换它们。之后创建新配置时，重新运行即可。

## 配置提供方路由

插件只发布凭据，由普通的 `llm-pi-ai` 路由使用。请在该配置的 `cordis.patch.yml` 中加入一次：

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

路由名必须是 `openai`。pi-ai 适配器只在该提供方名下识别 Sign in with ChatGPT 套餐请求：将请求发往 `https://api.openai.com/v1/responses`，使用 `store: false`、`stream: true`，并省略套餐流程不接受的请求字段。换成其他路由名会使用错误的端点与请求结构。

模型 id 来自账户通过 `GET https://api.openai.com/v1/models` 暴露的目录（`visibility` 为 `list` 的条目）。登录后可在 **Settings → OpenAI OAuth** 查看该列表。DSH 已安装的 pi-ai 目录已描述当前套餐模型，因此只写 `id` 也能继承其能力；上面的条目用于固定账户可见的模型与容量。

你自己的配置会被保留：Cordis 的配置覆盖会整体替换 `llm-pi-ai` 条目，请把其他提供方一起保留在同一段配置中。

## 在 ChatGPT 套餐与 OpenAI API key 之间切换

同一个 `openai` 路由一次只使用一种认证。**Settings → OpenAI OAuth** 会显示当前选择，并切换该路由的 `apiKeyEnv`：

- **ChatGPT 套餐** —— `OPENAI_CHATGPT_ACCESS_TOKEN`，由本插件发布；请求使用订阅套餐。
- **OpenAI API key** —— `OPENAI_API_KEY`，你在 Models 页保存的密钥；请求按 API 账户计费。

切换只改写 profile 中 `llm-pi-ai` 配置的这一个字段；模型和其他提供方保持不变，且从下一个请求生效，无需重启。未保存 API key 时无法切到 API 模式；未登录时仍可切到套餐模式，但要登录后套餐请求才可用。两种模式共用该路由的模型列表，请使用两边账户都提供的模型 id。

## 登录

打开 Harness Web 界面，进入 **Settings → OpenAI OAuth**：

```sh
npx @deepseek-ai/dsh web
```

用 DSH 打印的 Web 地址建立浏览器会话；账户与模型操作依赖该已认证的本地会话。阅读隐私说明后选择 **Continue with ChatGPT**。插件启动一次性 loopback 监听并打开 OpenAI 授权页。请在页面上确认所请求的权限；`chatgpt.tokens.use.direct` 允许使用套餐。返回 Harness 后，设置页会显示已登录账户、套餐使用是否已授权，以及账户的模型目录。

要启用已保存账户，选择 **授权并切换到此账户**。Harness 会复用该账户已有的注册重新完成 OAuth，验证成功后切换；取消或验证失败时保持当前账户不变。

退出登录时，插件会在可能的情况下撤销可续期会话。若无法确认撤销，Harness 仍会清除本地令牌并如实提示；你也可以在 ChatGPT 设置中断开该应用。等待中的授权可以在设置页停止，本地尝试会被取消，随后可立即重新登录。

Headless 配置使用同一个 Harness 凭据库（默认 `~/.dsh/.credentials.yaml`，仅属主可读）。先在 Web 界面登录一次，`headless` 即可读取已保存的授权。没有终端登录命令。

### 凭据存放位置

授权凭据保存在 DSH 的凭据记录中，而不是 `cordis.patch.yml` 或插件配置里。只有你的系统用户可以读取该凭据文件。访问令牌、刷新令牌与 ID token 留在 Host：不会返回设置页、写入日志或放进浏览器存储。访问令牌还会以 `OPENAI_CHATGPT_ACCESS_TOKEN` 引用的形式写入同一个凭据库，供提供方路由读取；令牌轮换时重新发布，退出登录时删除。host 标识与账户/客户端映射在退出后保留，以便再次登录复用已签发的 client；令牌不保留。

### 隐私与数据处理

新授权会以独立插件 `dsh-openai-oauth` 的身份注册。已有注册继续使用已签发的 client ID。本地账户映射包含已验证的账户标识、OpenAI 提供的邮箱，以及注册 ID。退出登录会清除该账户可用的凭据，并保留映射以便再次登录。授权管理与套餐限额请在 [ChatGPT 设置](https://chatgpt.com/settings/usage) 中处理。

推理由你配置的 Harness 提供方路由完成，而不是本插件。选择该路由时，请求、会话上下文以及保留的输入图片会发送给 OpenAI 用于推理。任何选择该路由的 Harness 请求都会使用套餐，包括自动标题、定时任务与自动 goal 轮次；不应使用套餐的请求请选择其他默认模型。请只在你能控制的运行环境中、为自身请求使用该授权。[OpenAI 隐私政策](https://openai.com/policies/privacy-policy/) · [使用 ChatGPT 登录的条款](https://openai.com/policies/sign-in-with-chatgpt-terms/)

## 模型

DSH 模型选择器只显示 `openai` 路由声明的模型。插件在 **Settings → OpenAI OAuth** 中列出当前账户的实时目录，便于复制模型 id；真正的模型选择属于 **Settings → Models**，那里统一管理所有提供方路由。

## 生成上限

套餐流程不接受 `max_output_tokens`，因此路由上的 `maxTokens` 不会作为输出上限发送，实际以上限由账户自身限制决定。Harness 仍会记录并显示 token 用量。会话启用上下文压缩时，由 Harness 针对同一路由执行。

## 用量与限额

ChatGPT 套餐用量受 OpenAI 限制，并与其他使用该套餐的应用共享。达到限额时，会作为普通的 Harness 提供方错误返回，并指出受影响的请求。[ChatGPT 设置 → 用量](https://chatgpt.com/settings/usage)

## 故障排查

- **`MISSING_CREDENTIAL`**：当前未登录，路由的 `apiKeyEnv` 引用为空。请在 **Settings → OpenAI OAuth** 登录。
- **套餐使用未授权**：授权有效但缺少 `chatgpt.tokens.use.direct`。请重新授权套餐使用，并在 OpenAI 页面上确认。
- **配额或资格错误**：检查 ChatGPT 用量与账户/工作区策略。插件不会对同一个不合格请求循环重试。
- **授权被撤销**：重新登录。Harness 会停止使用失效令牌，而不是反复重试。
- **临时刷新失败**：插件会隔离该授权，而不是复用可能已轮换的刷新令牌。账户映射会保留，重新登录即可恢复。
- **模型选择器为空**：确认配置中声明了 `openai` 路由且 `apiKeyEnv: OPENAI_CHATGPT_ACCESS_TOKEN`，然后在 **Settings → Models** 中保存该提供方。

## 卸载

```sh
npx -y dsh-openai-oauth uninstall
```

会从所有现有配置中移除该包，并保留凭据以便重装后复用账户映射。如需撤销会话，请先在设置中退出登录。没有 `--purge-auth` 选项：插件不会删除任意凭据目录或 Codex 目录。已有的 Codex CLI 数据不受影响。

## 预览限制

SIWC 仍处于预览阶段。OpenAI 可能调整端点、scope 或资格规则；流程变更后需要重新登录。

## 已知限制

- **不再按会话绑定账户。** 插件不再记录某会话由哪个账户开始；下次请求时，Harness 会把该会话的历史发送给当前登录的账户。因此切换账户后，已有会话会继续在新账户下进行，并会把保留的上下文发送给新账户。若某会话不应迁移，请先退出登录而不是切换账户。
- OpenAI 当前的 SIWC 套餐流程会在之后的请求或刷新时提示已断开。若请求或刷新确认授权失效，请重新登录。
- 本 loopback 安装不会通过 OIDC Back-Channel Logout 接收账户安全通知；该集成需要公网可达的 HTTPS 端点。[OpenAI 账户安全通知](https://developers.openai.com/siwc/account-security-notification)
- 发布的访问令牌按定时器提前五分钟刷新。进程若挂起时间超过刷新窗口，可能在下一次发布前用过期令牌发出一次请求；该请求会明确失败，重试时使用已刷新的令牌。

## 本地开发

```sh
npm install
npm test
npm pack --dry-run
```

本项目为独立社区插件，未获 DeepSeek 或 OpenAI 背书。

## 许可证

MIT
