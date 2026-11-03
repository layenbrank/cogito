# Agent 鉴权与模型供应商

Agent 对话经 **goose ACP** 侧车执行。模型鉴权按供应商类型分流；**不要**把 Cogito 登录、个人 API Key、Cursor CLI 登录混为一谈。

## 三类鉴权

| 类型 | 供应商 | 凭证 | 失败时怎么做 |
| --- | --- | --- | --- |
| 组织模型 | `cogito_gateway` | Cogito JWT（`<appData>/cogito/jwt`，goose `auth.command` → `cogito --token-helper`） | 重新登录 Cogito；必要时完整重启客户端以重载 goose |
| 个人 BYOK | OpenAI / DeepSeek 等 | 设置页保存 API Key（OS Keyring + goose config） | 「设置 → 模型」保存密钥并做 readiness |
| 本机 CLI | `cursor-agent` / Gemini CLI 等 | 本机 CLI 登录态或环境变量（如 `CURSOR_API_KEY`） | 终端 `agent login`，或设 Key 后重启客户端 |

组织默认路径是 **网关 + JWT**，不以第三方个人 CLI 作为企业默认。

## Cursor Agent CLI

goose 内置供应商 id 多为 `cursor-agent`。调用本机 `agent` / `cursor-agent`，**不读** Cogito JWT，也**不读** Cursor IDE 登录态。

预鉴权方式（官方）：

- `agent login`（浏览器 OAuth）
- `CURSOR_API_KEY` / `--api-key`
- ACP 另支持 `CURSOR_AUTH_TOKEN` / `--auth-token`

客户端：

- 启动 goose 时注入扩展 `PATH` + 透传 `CURSOR_API_KEY`（见 `utils/cursor_agent.rs` / `goose_serve.rs`）
- 「设置 → 模型」有 **Cursor Agent CLI** 状态卡（IPC `cursor-agent:status`）
- 运行时报错经 `parseAuthRequired` 识别未登录，给出专用引导（不再误导去 `goose configure`）

## 流式渲染

cogito **已在流式**：UI ← goose ACP `session/update` ←（可选）上游 Cursor Agent。

官方 [Cursor CLI ACP](https://cursor.com/docs/cli/acp) 也可直连：

- `agent acp`：stdio JSON-RPC；`session/update` → `agent_message_chunk`
- print：`agent -p --output-format stream-json --stream-partial-output`
- SDK：`@cursor/sdk` 的 `run.stream()`

### 为何暂不并列直连 `agent acp`

| | goose + cursor-agent（现状） | 直连 `agent acp` |
| --- | --- | --- |
| 流式 | 已可用 | 原生 chunk |
| 多供应商 / 组织网关 | 一套 goose | 需旁路 |
| Cursor 扩展（plan / todos / ask_question） | 通常不可用 | 可用 |
| 权限 UI | goose 审批 | 自实现 `session/request_permission` |

仅当产品需要 Cursor 原生 `cursor/create_plan`、`cursor/ask_question` 等扩展方法时，再评估并列 `agent acp`（参考官方 Minimal Node.js client / avante.nvim）。**团队 Dashboard MCP 在 ACP 模式下不受支持。**

## 相关代码

- `apps/client/src/features/agent/acp/session.ts` — `parseAuthRequired`
- `apps/client/src/features/agent/acp/cogito-provider.ts` — 组织网关注册
- `apps/client/src-tauri/src/utils/cogito_provider.rs` — `custom_providers` + `auth.command`
- `apps/client/src-tauri/src/utils/cursor_agent.rs` — CLI 探测与 goose 环境
- `apps/client/src/views/agent/settings/sections/cursor-cli-status.tsx` — 设置页状态
- `docs/apps/client/persist.md` — JWT / Keyring 分层
