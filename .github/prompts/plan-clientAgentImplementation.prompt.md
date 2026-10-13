# Plan: apps/client agent 完整实现（客户端重构 + cogito/ai-worker 协同）

## 用户已确认

- 目标 `apps/client/src/views/agent`（**复活** client）。
- 架构：全量重构到 `packages/chat`（端口/适配器）+ `packages/design/assistant` 的 `Thread` 槽位；引擎保留 **goose ACP**。
- 模型链路：**平台网关优先（cogito gateway）+ BYOK 兼底**。
- 持久化：**本地为主 + 服务端同步**（cogito 新增 chat 域）。
- 平台工具：**新建服务端 MCP**（cogito 暴露 streamable-HTTP，包装 ai-worker 5 工具）给 goose。
- 长任务：客户端**可委派给服务端** durable `agent.run`。
- 排除 MCP Apps。**允许破坏性重构**，服务端可改；遵循"合并进现有逻辑/删旧路径/不双轨/职责单一/策略·表驱动"。
- **JWT 刷新**：Tauri 注入 `GOOSE_*` 环境 + **只读 helper**（helper 只负责打印 token 文件内容，Tauri 原子改写该文件）。
- **`packages/chat` 要改**：可先 `git branch`/备份，或复制子包——**建议直接改（加法式、向后兼容）**，不复制子包（避免双轨）。
- **同步边界**：本期只同步 会话 / 消息 / 用量。

## goose 集成点（已二次核实，含 go 最新代码）

- **自定义 provider 可经 ACP 创建**：`_goose/unstable/providers/custom/create` 的 `CreateCustomProviderParams{engine,display_name,api_url,api_key?,models[],supports_streaming?,headers?,requires_auth,catalog_provider_id?,base_path?,toolshim,preserves_thinking?,auth?}` → 落盘 `<config_dir>/custom_providers/<id>.json`（`persist_custom_provider`）。
- `DeclarativeProviderConfig`：`engine(openai|ollama|anthropic)` / `base_url`（直达 completions 端点）/ **`headers`（静态 map）** / `base_path` / `env_vars`（`${VAR}` 模板）/ `models[]`（含 `context_limit`/成本）/ `dynamic_models` / `supports_streaming` / `preserves_thinking`；**`auth` 与 `api_key_env` 互斥**。
- `AuthConfig{command,args,refresh_interval(默认3600,0=仅被动刷新),timeout_seconds?,cwd?}` → `CommandAuthProvider` 执行命令取回凭证、缓存 `refresh_interval` 后重取，并在 **401 时被动刷新**（不需重启 goose）；header 名/前缀由 engine 决定（openai = `Authorization: Bearer `）。
- 密钥读取优先级：**env 优先**（`std::env::var(KEY.to_uppercase())`）→ secrets store；故 Tauri 注入环境变量即可，不必写 keyring。
- MCP 扩展配置支持 `streamable_http`（`uri` + `headers`）。

## 关键事实（已核实，含服务端）

### goose（源码 `D:\Documents\monorepo\goose`）

- Desktop 已迁 **ACP over WebSocket**；`initialize` 需 `clientCapabilities.elicitation.form` + `_meta.goose.{mcpHostCapabilities,customNotifications,recipeParameterRequests}`。
- ACP 标准：`session/{new,load,list,prompt,cancel,update}`、`session/request_permission`、`elicitation/create`（表单，超时 300s）。
- `_goose/unstable/*` 已注册（`crates/goose/src/acp/server/*`）：`tools/{list,permissions/set,call}`、`resources/read`、`config/{read,upsert,remove,read-all}`、`config/extensions/{list,add,remove,set-enabled}`、`session/extensions/{list,add,remove}`、`session/{working-dir/update,system-prompt/set,steer,rename,archive,unarchive,info,export,import,conversation/truncate,project/update}`、`providers/{list,catalog/list,setup/catalog/list,custom/*,inventory/refresh,readiness/check,config/*,secrets/*,canonical-model-info,supported-models/list}`、`defaults/*`、`preferences/*`、`diagnostics/get`、`recipes/*`、`schedules/*`、`slash-commands/list`、`agent-mentions/list`、`sources/*`；通知 `_goose/unstable/session/update`、`providers/authentication/device-code`；agent 请求 `session/recipe/request-params`。
- 权限：goose 原生 4 档 `auto|approve|smart_approve|chat`（`session/set_config_option`）；每工具 3 档 `always_allow|ask_before|never_allow`。
- **网关接入可行**：内置 OpenAI provider 支持 `OPENAI_BASE_URL`（无 `/v1` 时 base_path 默认 `chat/completions`）、`OPENAI_BASE_PATH`、`OPENAI_API_KEY`(Bearer)、**`OPENAI_CUSTOM_HEADERS`**（可带 `X-Tenant-ID`）。
- 更优：**声明式自定义 provider** `DeclarativeProviderConfig.auth` 支持 `command`+`args`+`refresh_interval`+`header_name`/`header_value_prefix`（`providers/command_auth.rs::CommandAuthProvider`）→ 短时 JWT 可由脚本刷新，无需本地代理。

### cogito（`apps/cogito`）

- 网关用户面（`Auth::isRequired()`）：`POST /api/v1/gateway/chat/completions`（`stream:true` = SSE，**上游 OpenAI 原样直传**，`stream_options.include_usage` 由服务端补）、`GET /gateway/models`（含 `auto` 伪项 + `capabilities`/`contextWindow`）、`GET /gateway/quota/me?model=`（`SelfQuotaR{limit,used,remaining,exhausted,resetsAt,...}`）、`GET /gateway/plans`。失败为统一错误信封 + 真实 HTTP 状态（配额 `400006`→429）。
- 鉴权：`Authorization: Bearer <JWT>`（HS256）+ **`X-Tenant-ID`**（租户选择器，agent 端点必填）。JWT claims 只有 `sub/username/role/exp/iat`（无 tenant/scope）。登录 `POST /api/v1/auth/signin` → `SigninR{token,...}`。`scope=chat` 令牌是 ai-worker 出站用，**客户端不要接**。
- 服务端 agent：`POST /api/v1/agent/tasks`（`TaskP{objective,maxSteps?,tools?}`，**无幂等键**）、`GET /agent/tasks/{id}`（`TaskR{status,steps,progress,pendingApproval,finished,result,error,...}`，**只能轮询**）、`POST /agent/tasks/{id}/approvals/{approvalID}`（`ApprovalP{decision:APPROVED|REJECTED,reason?}` → `ApprovalR{applied,...}`；`applied=false` 是幂等重发；`500503`=决定在册但投递失败，同向重发即补投）。
- durable：`crates/durable`（duroxide；`raise_event` 位置配对 vs `enqueue_event` 缓冲邮箱；进度 `custom_status` **只在轮次边界持久化，永远落后一步**）。
- 事件：outbox + 平台通道 + webhook（`crates/audit`、`entity/src/outbox.rs`、`src/worker/*`）；**无 SSE/WS 推送**（全仓 `text/event-stream` 仅网关一处）。
- 幂等：对公 API **无幂等中间件**；对内（cogito→ai-worker）用 `Idempotency-Key` 头。
- **无任何通用同步机制**（无 cursor/version/etag/conflict resolution；仅 asset 有 `archivedAt` 软删）。
- 迁移：`migration/src/000001_20260819.rs` 单文件、开发期**整体 DROP 重建**；**表名 snake_case、列名 camelCase**（如 `tenantID`/`createdAt`）；RLS 同文件 `STRICT_TENANT_TABLES` + `enable_rls`。
- 新增域清单（照 `rag` 样板 11 步）：`entity/src/<d>.rs` → migration（drop/create/index/RLS/`DeriveIden`）→ `crates/<d>/{lib,persistence}.rs` → `scripts/capabilities.ts`（`CAPABILITIES` + `LEGACY_SERVICES`）→ Cargo 依赖 → `src/services/<d>/{module,controller,service,schema,error,dispatch}.rs` → `application/module.rs` 注册 → `src/oas/{paths,<d>,mod}.rs` → 编排（如需）→ `cargo run --bin docs` + `bun run contracts` → 测试。
- 契约生成：`spec/openapi.json`（utoipa）→ **`packages/types/src/openapi.d.ts`（`@i-thinking/types`，已提交、CI 漂移门禁、目前零消费者）**。
- 门禁：`tests/{route_reachability,oas_consistency,<d>_scope}.rs`、`scripts/arch.ts` R1–R11（能力 crate 依赖方向、表所有权对账、`/internal/**` 只出现在 `src/clients`、封禁依赖…）。

### ai-worker（`apps/ai-worker`）

- 5 工具（`agent_runtime/tools.py`，JSON Schema 与 MCP `inputSchema` 同形）：`knowledge_search`/`asset_read`/`memory_recall`（读）、`memory_write`/`asset_visibility_write`（**需审批**）；`catalog()` 输出 OpenAI 线格式。
- **仅内网**：`host=127.0.0.1`（容器 0.0.0.0 但不映射宿主端口）、无 docs 面、`X-Internal-Token` 全局闸门、全部路径 `/internal/v1/**`、契约唯一源 `apps/cogito/spec/internal.yaml`、出站仅 `cogito_client.py` 5 条白名单。
- 门禁：`test_route_surface.py`（暴露路由必须在 `internal.yaml` + `CAPABILITY_ROUTES` 认领）、`test_contract_conformance.py`。
- 结论：**MCP 应放 cogito**（唯一持有身份/租户/资产/审批台账/出网点）；ai-worker 加 MCP 会违反对内定位。

### client 现有可复用/需删

- 复用：`utils/http/{http,env,trace,stream,errors}.ts`（baseURL=ENV_URLS、Bearer、traceparent；**缺 `X-Tenant-ID`**）、`stores/{agent,provider}.ts`（乐观更新+`event$`）、`src-tauri/src/utils/{goose_serve,goose_acp,goose_tls}.rs`、`crates/{command,core,database}` 5 表（**重命名为 `agent_*`，见 [D4](#d4-本地持久化对应-ws-2)**）、`acp/{connection,wss-stream,goose-providers,goose-usage,permission}.ts`。
- 死代码（删）：`src/apis/agent.ts`、`model/ollama.ts`、`model/openai.ts::chatOpenAI`（+`mergeToolCallDeltas`/`serializeMessages`）、`model/agent-loop.ts`、`model/agent-tools.ts`、旧 `bubbles/workbench*/composer/agent-sender*/markdown-text`、`types.ts` 的 `'image'` 与旧 `MessagePart/ToolPart*`。
- `packages/types`、`apps/cogito/scripts/contracts.ts`、`apps/studio` 的 http/tenant/quota 实现可作参照。

## 工作流（Workstreams）

### WS-0 复活与基座

1. `apps/client/README.md` 去 DEPRECATED；根 `package.json` 移除 `!@i-thinking/client`（`lint/unit/coverage/dev`；`build` 待 CI 有 Rust/Tauri 后）；CI `type-check || true` → 硬失败 + `cargo check`。
2. `apps/client/package.json` 加 `@assistant-ui/react`、`assistant-stream`（catalog）；加 `@i-thinking/types`。
3. `utils/http/http.ts` 请求拦截器补 **`X-Tenant-ID`**（值取自登录后租户；参照 `apps/studio/src/utils/tenant.ts`）。

### WS-1 客户端 chat 层重构（端口 + Thread）_depends WS-0, WS-2_

0. **`packages/chat` 契约扩展（加法式，向后兼容 studio）**：见 [D1](#d1-packageschat-契约扩展对应-ws-10)。
1. `features/agent/port/history.ts`：`createHistoryPort()` 映射 `agent_session/agent_message → ChatThread/ChatStoredMessage`（`fragment→content`）。
2. `views/agent/chat/runtime.tsx`（**UI 装配，归窗口层**）：`useRemoteThreadListRuntime({adapter:createThreadListAdapter(historyPort), runtimeHook})` + `useLocalRuntime(createChatModelAdapter(chatModelPort,{findHost}))` + `useThreadIdentity()` + 中文 `AssistantLabelsProvider`。
3. `features/agent/acp/session.ts`（每 thread 会话控制器 + **单一派发器**，全部经端口下发，**不再开旁路事件通道**）+ `features/agent/acp/stream.ts`（`session/update → ChatStreamEvent` 全量映射：见 [D2](#d2-acp-sessionupdate--chatstreamevent-映射表对应-ws-13)）。`stores/agent.ts` 增 `ui` 分片承载 UI 态（表单草稿、plan 选中、审批票据展示）——**不新建 store、不承载事件流**。
4. `features/agent/port/{model,instance}.ts`：单例 `chatModelPort`（`instance.ts` 持单例）；`abort→session/cancel`；`respondToApproval→request_permission`（带 optionId）；`respondToElicitation→elicitation/create` 回执；`initialize` 补 `elicitation.form`；`finally` 写 `agent_usage`。票据设计见 [D3](#d3-会话控制器与票据对应-ws-1314)。
5. `views/agent/chat/chat.tsx` 重写为三栏 + `<Thread components={{...}}/>`（始终挂载 + collapse/expand + localStorage）；槽位组件从 studio 近乎 1:1 移植（`splitter-sizes/diff-lines/diff-view/tool-output/tool-terminal/tool-group/process-group/aside*/composer-*/workspace-file-picker/welcome`），`tool-card` 的**工具名表按 goose + MCP 工具名重写**；新写 `tool-elicitation.tsx`（JSON Schema 表单）。
6. 审批模型改用 goose 原生 **4 档** + 每工具 **3 档**（`tools/permissions/set`），删除 studio 式 `ask|auto|readonly`。写工具（`memory_write`/`asset_visibility_write` 等）默认 `ask_before`。

### WS-2 客户端本地持久化破坏性重构 _独立_

1. **就地改** `migrations_v001.rs`（单世代，**不新增 v002**）+ **域命名统一为 `agent_*`**（表 / 实体 / 命令 / 通道 / 类型，一次性重命名、不留双轨）：见 [D4](#d4-本地持久化对应-ws-2)。
2. entity/command/service/DTO + `magnetic-tile-agent.d.ts` 同步；`agent_usage` 新 CRUD；`deleteMessages` 按 `parentID` 级联。

### WS-3 模型链路：网关优先 + BYOK 兼底 _depends WS-1_

1. 经 ACP `_goose/unstable/providers/custom/create` 注册 `cogito_gateway`（载荷见 [D5](#d5-网关-provider-与只读-helper对应-ws-3)）：`engine=openai`、`api_url=${cogito}/api/v1/gateway/chat/completions`、`headers={"X-Tenant-ID":"<tenant>"}`、`auth={command:<只读 helper>, args:[<token 文件>], refresh_interval:<小于 JWT TTL>}`、`models[]` 取自 `/gateway/models`。**不设 `api_key`**。
2. 只读 helper：随包 `externalBin` 小工具（如 `i-thinking-token`），只做「读文件 → stdout」；Tauri 注入 token 文件路径；登录/刷新时原子改写 → goose 被动/定时重取，**无需重启 server**。
3. 模型目录：`GET /gateway/models`（`auto` + `capabilities` + `contextWindow`）映射到 ModelPicker；BYOK 走 goose 原生 provider；两路在 UI 用统一 provider 列表（策略模式分派）。
4. 配额：`GET /gateway/quota/me?model=` → 指示器 + **发送前软拦截**（照 `apps/studio/src/features/quota/gate.ts`）；真守门是 `400006`(429)。用量写 `agent_usage`（客户端）与网关 `gateway_usage`（服务端）各一份，**口径分开**。
5. tenant 切换 → `providers/custom/update` 更新 `headers`；未注入 `X-Tenant-ID` 时退化为账号归属（团队模型可见性/档位配额失效）。

### WS-4 服务端 chat 同步域（cogito）_depends WS-2_

- 表/路由/同步语义见 [D6](#d6-cogito-chat-同步域对应-ws-4)。
- 契约：`cargo run --bin docs` → `bun run contracts` → `packages/types/src/openapi.d.ts`，客户端消费 `components["schemas"][...]`。

### WS-5 服务端 MCP（cogito 暴露 ai-worker 工具）_depends WS-3_

- 端点/鉴权/工具映射见 [D7](#d7-cogito-mcp-面对应-ws-5)。
- 客户端：`config/extensions/add` 加 `streamable_http` 扩展；工具名 `<server>_<tool>` 落 `tool-card` 表；写工具置 `ask_before`。

### WS-6 长任务委派（客户端 → cogito agent）_depends WS-3, WS-5_

- UI 落 `views/agent/chat`（右栏/工具卡）与 `views/agent/settings`（子节），**不新增路由**（URL 只有 `/agent/chat`、`/agent/settings`）。
- 状态机/提交/审批/结果见 [D8](#d8-长任务委派对应-ws-6)。

### WS-7 设置面（客户端）

- Provider/模型（`providers/*` + `canonical-model-info` + readiness）、MCP 扩展管理（`config/extensions/*`、`session/extensions/*`）、权限（4 档 + 3 档）、上下文/用量、诊断（`diagnostics/get`）、Recipes（`recipes/*` + `session/recipe/request-params`）、Scheduler（`schedules/*`）、Remote server（外部 `goose serve`，改 `goose_serve.rs` 支持外部 URL）。Roaming 仅标注（非 ACP）。
- 全部落在 `views/agent/settings/` 的 sections 内，**不新增路由**；组件一律 `@i-thinking/design/*`，不手写 `<button>`/`<dialog>`。
- API Key 改由 goose `providers/secrets/*` 管理，**删 `model/provider-credentials.ts` 的 `providers.json` 明文**。

### WS-8 清理与验证

- 删死代码（见上）；`acp/index.ts` barrel 重整；跑验证。

## 关键文件

- 客户端：`views/agent/{chat/chat.tsx,chat/runtime.tsx,chat/components/*,settings/sections/*}`、`features/agent/{acp/*,model/*,port/*}`、`stores/{agent,provider}.ts`、`utils/http/http.ts`、`src-tauri/crates/database/src/{migrations/migrations_v001.rs,migration.rs,bin/migrate.rs}`、`src-tauri/crates/{database/src/entity/agent_session.rs,database/src/entity/agent_message.rs,database/src/entity/agent_workspace.rs,database/src/entity/agent_workspace_folder.rs,database/src/entity/agent_provider.rs,database/src/entity/agent_usage.rs,command/src/agent_*,core/src/agent_*}`、`src-tauri/src/utils/goose_serve.rs`
- 服务端：`apps/cogito/{entity/src,crates/chat,migration,src/services/chat,src/services/gateway,src/oas,src/orchestrations,scripts/capabilities.ts}`、`apps/cogito/spec/*`、`apps/ai-worker/src/ai_worker/agent_runtime/*`、`packages/types/src/openapi.d.ts`
- 参照不改：`packages/chat/*`、`packages/design/assistant/*`、`apps/studio/src/{views/agent,features/chat,host/capabilities/assistant}`

## 验证

1. 客户端：`pnpm --filter @i-thinking/client run type-check/lint/test:unit`；`cargo check --manifest-path apps/client/src-tauri/Cargo.toml`；改完 v001 后重建本地库（见 [D4](#d4-本地持久化对应-ws-2) 的 `fresh` 命令）。
2. 服务端：`cargo test -p cogito-*`（含 `chat_scope`/`route_reachability`/`oas_consistency`）、`bun run contracts:check`、`node scripts/commands/index.ts` 的 arch 检查（R1–R11）、ai-worker `pytest`（`test_route_surface`/`test_contract_conformance`）。
3. 手动：`pnpm dev:client` 全会话 CRUD/导出、流式（text+reasoning）、工具卡+终端、**4 档审批各一次**、elicitation 提交/超时、MCP 扩展（平台 MCP 工具调用 + 写工具审批）、provider 切换/readiness、配额 429 拦截、诊断导出、委派长任务（进度/审批/结果）、同步（离线改 → 联网 pull/push、冲突 409）。
4. 回归：studio `type-check`（若 `packages/chat` 有加法改动）。

## 决策（已定）

- **`packages/chat` 直接改**（加法式可选字段 + 新事件种类），开工前 `git branch` 备份；不复制子包（避免双轨）；改完跑 `apps/studio` 回归。
- **网关鉴权 = 声明式 provider 的 `auth.command` + Tauri 注入 `GOOSE_*` 环境 + 只读 helper**（无需重启 goose，无需写 keyring）。
- **同步 = cursor 增量 + 客户端生成 uuid 主键 + `revision`**，只覆盖 会话/消息/用量。
- **租户身份 = provider 静态 header，不做本地代理**：`X-Tenant-ID` 写在 goose 自定义 provider 的 `headers` 里（静态 map，无 `${VAR}` 模板），**切换租户时由 `providers/custom/update` 改写**；JWT 文件 `<appData>/cogito/jwt`；helper 路径由 Tauri 注入。
- **helper 形态 = 随包 Rust 小二进制**（`externalBin` + `sidecar`，与 `corex-mcp` 同路），跨平台；不用 `cmd`/`powershell`。
- **ACP SDK 不升级**：`@agentclientprotocol/sdk@1.7.0` 已满足（见下表 #9 实测）。
- 排除：MCP Apps、Roaming 实现。

---

## 规范对齐（`docs/guides/agent-conventions.md`）

- **目录归属**：`features/agent/` 只放 `acp/`、`model/`、领域类型 + **`port/`（适配层，已加入白名单）**；**所有 UI 组件与 runtime 归 `views/agent/chat/**`**（agent 部件属 `views/`）。
- **路由**：不新增路由，仍只有 `/agent/chat` 与 `/agent/settings`（分屏用布局路由 + 子页，禁 Dialog / 页内开关）。
- **命名**：禁 `get` 前缀（用 `find`/`fetch`）；解析用 `parse`；布尔 `is`/`has`/`can`；常量全大写蛇形；类型 PascalCase；**命名空间内去重复前缀** → `MagneticTile.Agent.Session` / `Message` / `Workspace` / `WorkspaceFolder` / `Provider` / `Usage`（不再是 `AiXxx`）；集合用复数、不含 `list`。
- **文件组织**：导出名 = 文件名 = 职责；一个域多文件 → 开目录（`port/`、`settings/sections/`）；**默认不建 barrel**（既有 `acp/index.ts` 收敛，不随新增文件扩张）。
- **导入路径**：同目录 `./x`；跨目录一律 `@/...`，**禁 `../../`**（含 `views/ → features/`）。
- **契约单一源**：改通道须同批动 `shared/ipc/channels.ts`（+ `specs/*` 若有）与 Rust `#[tauri::command(rename=…)]` 及**全部调用点**（client 无 studio 的 `preload.ts`/`handlers`，对应物是 `channels.ts` + Rust 注册 + store 调用点）。
- **UI 合规**：只用 `@i-thinking/design/{components,assistant}/*`；语义 token、不硬编码色值；按压用色阶（禁 `active:translate-y-px` / `active:scale-*`）；不手写 `<button>` / `<dialog>`；设计 token 唯一源不动。
- **改动审查**：合并进现有逻辑、删旧路径、不双轨；整段行为按场景替换 → 策略模式，按输入取值 → 映射表驱动（本计划已用：`tool-card` 工具名表、`stream.ts` 事件映射表、provider 两路分派）。
- **提交**：按主题分批、一条一意图、中文 conventional、逐文件 `git add`、`diff --cached` 复核。

---

## 详细设计（可编码粒度）

### D1 `packages/chat` 契约扩展（对应 WS-1.0）

新增类型与联合成员（全部**加法式/可选**，studio 现有 `HANDLERS` 不受影响）：

```ts
export type ChatApprovalOptionKind = 'allow-once' | 'allow-always' | 'reject-once' | 'reject-always'
export type ChatApprovalOption = { id: string; kind: ChatApprovalOptionKind; label?: string }
export type ChatPlanEntry = {
  content: string
  status?: 'pending' | 'in_progress' | 'completed'
  priority?: 'high' | 'medium' | 'low'
}
export type ChatMode = 'auto' | 'approve' | 'smart_approve' | 'chat'
export type ChatSchemaField = {
  name: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'enum'
  required?: boolean
  default?: unknown
  description?: string
  enumValues?: readonly { value: string; label?: string }[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}
export type ChatElicitationSchema = {
  title?: string
  description?: string
  fields: readonly ChatSchemaField[]
}
```

- `ChatStreamEvent` 追加成员：`{ kind:'plan'; entries: readonly ChatPlanEntry[] }`、`{ kind:'elicitation-request'; elicitationId: string; schema: ChatElicitationSchema; prompt?: string }`、`{ kind:'mode-update'; mode: ChatMode }`、`{ kind:'commands-update'; commands: readonly { name: string; description?: string }[] }`；`tool-approval-request` 增 `options?: readonly ChatApprovalOption[]`。
- `ChatToolApproval` 增 `optionId?: string`。
- `ChatModelPort` 增 `respondToElicitation?(input: { elicitationId: string; action: 'accept' | 'cancel'; content?: Record<string, unknown> }): boolean`。
- `adapters/chat-model.ts`：`createContentAccumulator` 增 `plan` 与 `elicitation` 块（仍按到达次序，禁止按类型归堆）；`toToolStatus` 不变。

### D2 ACP `session/update` → `ChatStreamEvent` 映射表（对应 WS-1.3）

| ACP `sessionUpdate`                                | 产出                                                                             | 备注                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `agent_message_chunk`（`content.type==='text'`）   | `text{blockID,text}`                                                             | `blockID` 取 `update.messageId ?? 自增`                                                                                           |
| `agent_thought_chunk`                              | `reasoning{blockID,text}`                                                        | 同上                                                                                                                              |
| `tool_call`                                        | `tool-call{toolCallId,toolName,input}`                                           | `toolName` ← `update.title`（ACP 无独立 name 字段；`rawInput` 含名优先）；`kind`（read/edit/execute/fetch/other）留作卡片形态分派 |
| `tool_call_update`（status=`completed`\|`failed`） | `tool-result{toolCallId,toolName,output,isError}`                                | `output` 取 `content`/`rawOutput`                                                                                                 |
| `plan`                                             | `plan{entries}`                                                                  | 不进文本块                                                                                                                        |
| `usage_update`                                     | 累加（不外发）                                                                   | 在 `finish/aborted/error` 的 `usage` 回填                                                                                         |
| `available_commands_update`                        | `commands-update`                                                                |                                                                                                                                   |
| `current_mode_update`                              | `mode-update`                                                                    |                                                                                                                                   |
| `user_message_chunk`                               | 忽略                                                                             | 本地已回显                                                                                                                        |
| 终态                                               | `session/prompt` 返回 `stopReason` → `finish`；abort → `aborted`；异常 → `error` | 每次 run **只发一个终态**                                                                                                         |

审批映射：ACP `RequestPermissionRequest.options[{optionId,name,kind}]` ↔ `ChatApprovalOption{id:optionId, kind}`；回执 `RequestPermissionResponse{outcome:{outcome:'selected',optionId}}` 或 `{outcome:{outcome:'cancelled'}}`。

### D3 会话控制器与票据（对应 WS-1.3/1.4）

- `features/agent/acp/session.ts`：每 thread 一个控制器；模块级 `Map<threadID, Controller>`；单例连接 `findAcpHandle()`。
- 控制器持有 `pending: Map<key, Ticket>`，`key = sessionId + '\u0000' + (toolCallId | elicitationId)`；ticket 三出口（回执 / abort / 超时 300s）必须落地，`settle()` 幂等（照 studio `createApprovalTicket`）。
- 回执链路：UI → `chatModelPort.respondToApproval/respondToElicitation`（模块级单例，键控 `toolCallId`/`elicitationId`）→ 控制器 `settle`；找不到 → 返回 `false`（UI 提示"已失效"）并 emit `tool-approval-failed`。
- 事件订阅：`client.connection.agent.onNotification('session/update')` 与 `elicitation/create`、`session/request_permission` 回调统一进派发器。

### D4 本地持久化（对应 WS-2）

**域命名统一为 `agent_*`（弃用 `Ai*`）**——一次性重命名，不留双轨：

| 旧（现状，待删除）                                     | 新（目标）                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 表 `aiSession` / `aiMessage` / `aiWorkspace` / `aiWorkspaceFolder` / `aiProvider` | `agent_session` / `agent_message` / `agent_workspace` / `agent_workspace_folder` / `agent_provider` |
| 新增用量表（原定 `aiUsage`）                           | `agent_usage`                                                                              |
| 索引 `idx_ai*` / 外键 `fk_ai*`                         | `idx_agent_*` / `fk_agent_*`                                                               |
| Rust 实体 `entity/aiSession.rs`（`AiSession`）         | `entity/agent_session.rs`（`AgentSession`）                                                |
| core 服务目录 `core/src/aiSession/`                    | `core/src/agent_session/`                                                                  |
| 命令 `command/src/aiSession.rs`（`rename="aiSession:toRead"`） | `command/src/agent_session.rs`（`agentSession:toRead`）                                    |
| 通道常量 `AI_SESSION` + 字符串 `aiSession:toRead`      | `AGENT_SESSION` + `agentSession:toRead`                                                    |
| 全局类型 `AiSession` / `AiMessage` / `AiWorkspace` / `AiWorkspaceFolder` / `AiProvider`（`MagneticTile.Agent.*`） | `MagneticTile.Agent.Session` / `Message` / `Workspace` / `WorkspaceFolder` / `Provider` / `Usage`——命名空间已含 `Agent`，按"有命名空间时可精简"去前缀；**限定名 `Agent.Session` 与 Rust `AgentSession` 同概念同名** |
| `stores/agent.ts` 消费的全局类型                        | 同上（`Agent.Session` / `Agent.Message` / …）；需要局部短名时用 `Session` / `Message` 别名，**不再写 `Ai*`** |
| `stores/provider.ts` 的 `AiProvider`                    | `AgentProvider`（该 store 无命名空间，保留 `Agent` 前缀标明归属）                            |

> **表 `agent_*` 用 snake_case，列仍 camelCase**（与 cogito `agent_task`/`agent_approval`、ai-worker `agent_memory` 对齐）。**目标名一律不含 `Ai`**：Rust 无命名空间用 `Agent*`，TS 在 `MagneticTile.Agent` 命名空间内用精简成员名（限定名同为 `Agent.*`）；实现完成后全仓不应再出现 `Ai*` 标识符（`agent-conventions.md` 已把 `port/` 加入 `features/agent/` 白名单）。

**单世代策略**：不新增迁移版本，**就地改** `apps/client/src-tauri/crates/database/src/migrations/migrations_v001.rs`（`src-tauri/crates/database/src/migration.rs` 的 `AppMigrator` 只注册这一个；记账表 `migrations`）。SeaORM 迁移**四处齐改**，漏一处会在重建后残留旧结构：

1. `up()` 建表段：`agent_session` 加 `AgentSession::ProviderId`（`string().null()`）；`agent_message` **删掉** `Thinking`/`Parts`，加 `AgentMessage::ParentId`（null）、`AgentMessage::Format`（`string().not_null().default("ith/thread-message-like")`）；新增 `agent_usage` 建表（`RunID` 唯一）。
2. `up()` 索引段：`idx_agent_message_parentID`、`idx_agent_usage_runID`、`idx_agent_usage_sessionID`（沿用现有 `CREATE INDEX IF NOT EXISTS` 写法）。
3. `up()` 末尾用于重建的 DROP 列表 与 `down()` 的 drop 列表：加 `AgentUsage::Table`，保持依赖倒序（`agent_usage` → `agent_message` → `agent_session` → `agent_workspace_folder` → `agent_workspace` → `agent_provider`）。
4. 文件末尾 `DeriveIden` 枚举：`enum AgentSession { Table, #[iden = "agent_session"] … }`（加 `ProviderId`）、`enum AgentMessage { … ParentId, Format }`（删 `Thinking`/`Parts`）、新增 `enum AgentUsage { Table, Id, RunId, … }`；⚠️ 表名/多词列名**必须显式 `iden`**（`#[iden = "agent_session"]`、`#[iden = "providerID"]`、`#[iden = "runID"]`），`DeriveIden` 默认会把多词转 snake_case。

字段映射：`AgentSession{id,title,pinned,providerID,workspaceID,createdAt,updatedAt} → ChatThread`；`AgentMessage{id,parentID,format,fragment→content,sessionID} → ChatStoredMessage`。新增 `AGENT_USAGE` 通道族（`agentUsage:toRead|toWrite|toUpdate|toRemove`）与 `stores/agent.ts` 的 `usage` 分片；`AgentUsage` 的 entity / `crates/command` / `crates/core` service 同形补 `toWrite/toRead/toUpdate/toRemove`。

**重建本地库**（开发期；`fresh` 会清空数据）：

```powershell
cd apps/client/src-tauri
cargo run -p thinking-database --bin thinking-database -- fresh -u "sqlite://<appdata>/i-thinking.db"
# 或直接删 `i-thinking.db`（路径见 crates/database/src/storage.rs::database_path），让启动时迁移重建
```

> 该 crate 自带 `src/bin/migrate.rs`（`sea_orm_migration::cli` 入口，包名/bin 名均为 `thinking-database`），故也支持 `sea-orm-cli migrate fresh -u sqlite:…`。

### D5 网关 provider 与只读 helper（对应 WS-3）

创建载荷（`providers/custom/create`）：

```json
{
  "engine": "openai",
  "displayName": "cogito",
  "apiUrl": "<cogito>/api/v1/gateway/chat/completions",
  "headers": { "X-Tenant-ID": "<tenantID>" },
  "requiresAuth": true,
  "supportsStreaming": true,
  "preservesThinking": true,
  "models": [{ "name": "deepseek-chat", "contextLimit": 128000 }],
  "auth": {
    "command": "<helper 绝对路径>",
    "args": ["--file", "<appData>/cogito/jwt"],
    "refreshInterval": 120
  }
}
```

- helper：`i-thinking-token`（Rust 小二进制，`externalBin`）；无副作用，stdout 只输出 token 一行；文件缺失退出码非 0。
- Tauri 侧：登录/刷新时原子改写 `<appData>/cogito/jwt`；把 helper 路径经环境注入 `goose serve`。
- 配额门（发送前）：`GET /gateway/quota/me?model=` → `exhausted === true` 或 `remaining <= reserve` 时软拦截；硬守门是 `400006`(HTTP 429)，统一错误信封 → toast。
- 模型目录：`GET /gateway/models`；`auto` 伪项保留；`capabilities.tools` 决定是否 `supportsTools`。

### D6 cogito `chat` 同步域（对应 WS-4）

表（Postgres，**表名 snake_case / 列名 camelCase**）：

```sql
chat_session (Id uuid PK, TenantID text, UserID uuid, Title text, Pinned bool,
  WorkspaceID text NULL, Revision bigint, ClientUpdatedAt bigint, ArchivedAt bigint NULL,
  CreatedAt, UpdatedAt)
chat_message (Id uuid PK, SessionID uuid FK→chat_session.Id CASCADE, ParentID uuid NULL 自引用,
  Format text, Content text, Role text, Revision bigint, CreatedAt, UpdatedAt)
chat_usage (Id uuid PK, RunID text UNIQUE, SessionID uuid NULL, ProviderID text NULL,
  Model text NULL, Source text NULL, Outcome text NULL, InputTokens int NULL,
  OutputTokens int NULL, TotalTokens int NULL, CreatedAt, UpdatedAt)
```

路由与语义：

| Method | Path                                  | 入参                                                                                                           | 出参                                 | 要点                                                                              |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| POST   | `/api/v1/chat/sync`                   | `{ clientBatchID, baseRevision, upserts{sessions[],messages[],usages[]}, deletes{sessionIDs[],messageIDs[]} }` | `{ applied, revision, conflicts[] }` | 幂等：行主键 + `clientBatchID` 同事务去重；`baseRevision` 落后 → `409` 带服务端行 |
| GET    | `/api/v1/chat/sessions?since=&limit=` | cursor                                                                                                         | `{ items[], revision, hasMore }`     | `WHERE Revision > since ORDER BY Revision ASC`；tombstone 随增量下发              |

- `Revision` 由服务端单调分配；`ArchivedAt` 非空即 tombstone。
- 客户端同步器：本地先写（离线优先）→ 后台批量 push/pull；`agent_session.revision` 作水位；冲突面仅 `title/pinned`（消息 append-only）。
- 门禁：`chat_scope.rs` 端到端；`route_reachability`/`oas_consistency`；`scripts/arch.ts` R4/R5 表所有权对账；契约经 `cargo run --bin docs` + `bun run contracts` 生成 `packages/types/src/openapi.d.ts`。

### D7 cogito MCP 面（对应 WS-5）

- 端点 `POST /api/v1/mcp`（streamable HTTP；JSON-RPC `initialize` / `tools/list` / `tools/call`，可选 SSE 响应流）。
- 工具清单直接复用 ai-worker `tools.catalog()`（JSON Schema = `inputSchema`），工具名前缀 `<server>_<tool>`（server = `cogito`）。
- 鉴权：`Authorization: Bearer <JWT>` + `X-Tenant-ID` → `TenantCtx`；越权/不存在一律按 404 语义。
- 内部调用：读工具转发 ai-worker `/internal/v1/agents/tool-executions`（复用 `allowedTools` 白名单 + `approved` 准入）；写工具（`memory_write`/`asset_visibility_write`）走 cogito `agent_approval` 台账。
- 客户端接入：`config/extensions/add` 加 `streamable_http` 扩展（`uri=${cogito}/api/v1/mcp`，`headers` 带 Bearer/`X-Tenant-ID`）；写工具置 `ask_before`。

### D8 长任务委派（对应 WS-6）

客户端状态机：`idle → submitted → running → awaiting_approval → settled`（`settled ∈ {SUCCEEDED, FAILED}`）。

- 提交：`POST /api/v1/agent/tasks`（补幂等键，建议新 header `Idempotency-Key`；服务端加对公幂等中间件或表去重）；本地落 `taskID` 与已提交审批集合。
- 进度：轮询 `GET /agent/tasks/{id}`（`progress`/`steps`/`pendingApproval`/`finished`/`status`）；进度有"落后一步"特性，终态只看 `status`。
- 审批：`pendingApproval{approvalID,step,tool,arguments,expiresAt}` → 弹卡 → `POST .../approvals/{approvalID}`；`applied=false`/`500503` 视为幂等成功；本地持久化避免重复弹窗。
- 结果：`result` 为 `AgentRunOutput{taskID,steps,finished,answer?,toolCalls,memoryID?,approvals[]}`；`finished=false` 仍可能有 `answer`；用量按服务主体查网关。

### D9 实施顺序（PR 拆分）

1. **PR1** WS-0 复活与基座（无行为变更；CI 门禁）
2. **PR2** `packages/chat` 契约扩展（+ `apps/studio` 回归）
3. **PR3** WS-2 本地持久化（就地改 `migrations_v001.rs`）
4. **PR4** WS-1 客户端 chat 层（端口 + Thread UI + 槽位组件）
5. **PR5** WS-3 网关 provider + 只读 helper + 配额
6. **PR6** WS-7 设置面（provider/扩展/权限/用量/诊断）
7. **PR7** WS-4 cogito `chat` 同步域
8. **PR8** WS-5 cogito MCP
9. **PR9** WS-6 委派
10. **PR10** WS-8 清理 + 全量验证

> 依赖：PR4 依赖 PR2/PR3；PR7 依赖 PR3；PR8 依赖 PR5；PR9 依赖 PR5/PR8。PR6 可与 PR7–PR9 并行。

### D10 开放项与风险

- `tool_call` 的**工具名**来源需在实现期对齐 goose ACP 实际字段（`title` vs `rawInput` vs `_meta`）；`tool-card` 标签表须同时覆盖 goose 内置工具名与 MCP `<server>_<tool>`。
- `@agentclientprotocol/sdk` `1.7.0` 是否含 `plan`/`available_commands_update`/`current_mode_update`/`elicitation/create` 类型——不足则升级到与 goose 同版本（可能连带 `_meta` 能力字段变化）。
- 对公幂等：cogito 目前**无对公幂等中间件**，`POST /agent/tasks` 与 `POST /chat/sync` 都依赖新增；若引入统一 `Idempotency-Key` 中间件，应一次做完（避免两个域各写一份）。
- 同步 `Revision` 分配若用 `max+1` 需注意并发；建议按租户序列或触发式递进。
- **本地库单世代**：改 v001 后旧库须 `fresh`/删库重建（本地数据清空，开发期可接受）；发布前需确认是否给已装用户补数据迁移。
- `DeriveIden` 多词列名必须显式 `#[iden = "xxxID"]`，否则建出 snake_case 列（与列名约定不符）。
- **重命名要同批改**：表名（`agent_*`）+ Rust 实体/服务/命令模块 + `#[tauri::command(rename=…)]` + `shared/ipc/channels.ts` + `stores/*` 调用点 + `magnetic-tile-agent.d.ts`——缺一处编译不过（勿留 `Ai*`/`agent_*` 混用）。

---

## 进度（执行记录）

### ✅ 已完成
- **PR1a · WS-0 复活与基座** — 2026-10-12
  - `apps/client/README.md`：移除 DEPRECATED 横幅，正文改为「架构要点」（保留窗口自绘 / 磁贴两层 / agent 布局路由等事实）。
  - `apps/client/package.json`：新增 `unit`（`vitest run`）与 `coverage`（`vitest run --coverage`）脚本。
  - 根 `package.json`：`unit` / `coverage` 去掉 `--filter=!@i-thinking/client`，client 重新并入聚合任务（`lint` 在 PR1b 里并入）。
  - 验证：`pnpm --filter @i-thinking/client run unit` → **20 文件 / 126 用例全绿**；`coverage` → v8 报告正常。
  - 未做（有意）：`dev` / `build` / `e2e` / `preview` 仍排除 client（各有独立脚本 `dev:client` / `build:client`）。

- **PR1b · 清既有错误、门禁转硬** — 2026-10-12

  冷缓存跑 `pnpm lint`（原来命中 turbo 缓存、只是**重放历史 PASS 日志**）时，暴露出与本次改动无关的既有错误，一并清零：

  | 文件 | 规则 / 类型 | 修法 |
  | --- | --- | --- |
  | `packages/agent/src/client/openai-compatible.ts:123` | `no-unused-vars` | `toolName` → `_toolName`（回调签名不变） |
  | `packages/design/src/components/input.tsx:44` | `no-empty-object-type` | `interface X extends Omit<…> {}` → `type X = Omit<…>` |
  | `apps/studio/forge/makers.ts:65` | `studio/catch-must-report` | 空的 `catch {}` 改成把原因带进 `throw`（原来直接吞掉，报错只剩「无法解析」） |
  | `apps/studio/scripts/run-forge.ts:66` | `studio/catch-must-report` | `execSync` → `spawnSync('candle', ['-?'])`，探测失败不再靠 catch 吞异常（`execSync` 导入随之删除） |

  client 的 11 个 lint error：

  | 文件 | 规则 | 修法 |
  | --- | --- | --- |
  | `components/decorations/decorations.tsx:29` | `eqeqeq` | `begin != null` → `!== null && !== undefined` |
  | `features/agent/acp/wss-stream.ts:63,93` | `no-this-alias` | 去掉 `const socket = this`，回调改箭头函数直接用 `this` |
  | `features/agent/model/workspace-path.ts:5` | `prefer-const` | `let next` → `const next` |
  | `stores/agent.ts:591` | `eqeqeq` | `item.archivedAt == null` → 显式双判空 |
  | `views/directive/orchestrator/canvas/step-node-icon.ts:1` | `consistent-type-imports` | `findStepKind` 只出现在 `ReturnType<typeof …>` → `import type` |
  | `views/directive/run/run-log-text.ts:5` | `no-control-regex` | 剥 ANSI 必须点名 ESC → 就地 `eslint-disable-next-line` 加理由 |
  | `views/directive/run/run-log-text.ts:16,19,21` | `eqeqeq` ×3 | `!= null` → 显式双判空 |
  | `doctor.config.ts` | 解析错误（不在 project service） | 该配置 import 的 `react-doctor` **本仓根本没装**（无依赖、无脚本引用）→ 按 `tailwind.config.ts` 先例加入 `globalIgnores` |

  client 的 15 个 tsc error（`tsc --build`）：

  | 文件 | 报错 | 修法 |
  | --- | --- | --- |
  | `components/contextmenu/surface/panel.tsx` ×4 | motion 四个 prop 声明成 `unknown` 传不进 `m.div` | 删掉重复的 `PanelMotion`，直接用 `menu.ts` 已导出的 `MenuMotionSlot` |
  | `features/controller/controller.tsx` ×3 | `transitionRef.current` 可空 | ref 惰性初始化换成 `const [transition] = useState(bindMirrorTransition)`（纯工厂，无副作用），从源头消掉可空 |
  | `views/collection/controller.tsx` ×2 | 根节点是 `<button>` 却用的是 div 事件类型 | `onClick` / `onKeyDown` 改为 `HTMLButtonElement`；`onPrevent` 仍走 `HTMLDivElement`（它转发给 Navigation 的 div） |
  | `inspector/condition-node-{compare,logic}.tsx` ×5 | `...props.condition` 展开失败（`Condition = string \| {…}`） | 新增并导出 `ConditionObject = Exclude<Condition, string>`，两个 props 改用它（`logic` 里那句 `& { and?, or? }` 是无效补偿，已删） |
  | `views/marketplace/workspace/lib/insert-tile.ts:4` | 局部 `parseTileWrite` 与外层 import 重名（实际会**自递归**） | 包装函数改名 `buildTileWrite`，并从 export 列表移出（外部只 import `insertTile`） |

  **门禁状态**（已验证）：
  - `pnpm lint`（含 client）→ `13 successful, 13 total`，client `0 errors`（152 warning，按配置属存量降级项）。
  - `pnpm --filter @i-thinking/client run type-check` → 退出码 `0`。
  - `pnpm --filter @i-thinking/client run unit` → 126 用例全绿（改动后回归）。
  - CI：`Type check` 步骤对 client 去掉 `|| true`（extension 仍留）。

  **未做（有意）**：CI 未加 client `cargo check` —— 该 job 是 `ubuntu-latest`、无 Rust 工具链，需先装 `dtolnay/rust-toolchain` + webkit2gtk 等系统依赖，且 30 分钟预算下风险高，留待单独决定。（→ 已在「门禁补齐」批次完成）

### 🔨 PR4 · WS-1 客户端 chat 层（进行中）

> 拆成 3 刀（比原计划多一刀：控制器与 UI 必须同批，否则旧工作台会失去审批能力 ——
> 那要么写兼容分支（双轨），要么让旧 UI 静默拒掉所有审批）。

**① 存储与事件映射（已提交）**
- `agent_message` 增量加 `parentID` / `format`（仍在 v001 就地改）；旧列 `thinking` / `parts` 与旧 UI 同批删，故这一刀不碰它们，保证每步都能编过能跑。
- `features/agent/port/history.ts`：走 `stores/agent.ts` 的仓储动作（含乐观更新/回滚/事件广播）而不是直接 `invoke`。
- `features/agent/acp/stream.ts`：纯映射表 + 16 条单测（文本/推理按 `messageId` 归组；工具名 `name` 优先回退 `title`；只有终态算结果；未知权限档位不猜；`usage_update` 走回调）。
- 两处实测差异（写进代码注释）：ACP 权限类别是 snake_case（`allow_once`）而共享层/assistant-ui 用连字符；ACP 联合类型带「未来类型」索引签名 → 字段读出来是 `unknown`，需就地收窄。

**② 会话控制器（已提交）**
- `features/agent/acp/session.ts`：会话生命周期（cwd / provider / model / configOptions / corex-mcp 注入）从 `model/goose-acp.ts` 搬入；轮次产出走**一条队列**（update + 反向审批/追问 + 终态）。
- 票据：审批与追问都有 300s 超时、`settle` 幂等、**票随轮次生死**（轮次结束一律作废并按取消回复）；`respondTo*` 找不到票返回 `false`，UI 如实提示「已失效」。
- 连接层改为**注入路由**（`bindAcpRequestRouter`），避免 `connection.ts` ↔ `session.ts` 模块环。
- `model/goose-acp.ts` 收缩为旧路径适配器（会话机器只有一份）；`compactThreadSession`/`switchGooseProviderModel`/`waitGooseReady` 从 `acp/session` 导出，3 处消费方改导入。
- 验证：client `tsc` 0、lint 0、单测 142/142。

**③ 待做（下一刀）**：`features/agent/port/{model,instance}.ts` → `views/agent/chat/runtime.tsx`（`useLocalRuntime` + `createThreadHistoryAdapter`）→ 三栏 UI + 槽位移植 → **同批删除**旧路径（`chatGooseAcp`、`agent-loop.ts`、`acp/permission.ts`、`acp/normalize.ts`、旧工作台 `workbench*`/`bubbles`/`plan-list`/`code-diff`/`compare-table`）。

### ⏳ 待完成

- **PR5 · WS-3 网关 provider + 只读 helper + 配额**（[D5](#d5-网关-provider-与只读-helper对应-ws-3)）
- **PR6 · WS-7 设置面**（provider / 扩展 / 权限 / 用量 / 诊断）
- **PR7 · WS-4 cogito `chat` 同步域**（[D6](#d6-cogito-chat-同步域对应-ws-4)）
- **PR8 · WS-5 cogito MCP**（[D7](#d7-cogito-mcp-面对应-ws-5)）
- **PR9 · WS-6 委派**（[D8](#d8-长任务委派对应-ws-6)）
- **PR10 · WS-8 清理 + 全量验证**

> 依赖（见 [D9](#d9-实施顺序pr-拆分)）：PR4←PR2/PR3；PR7←PR3；PR8←PR5；PR9←PR5/PR8；PR6 可与 PR7–PR9 并行。PR1b 不阻塞 PR2/PR3（可并行）。

### ✅ PR2 · `packages/chat` 契约扩展 — `0551426d`

- 新增类型：`ChatApprovalOption(Kind)`、`ChatPlanEntry`、`ChatMode`、`ChatCommand`、`ChatSchemaField/ElicitationSchema/ElicitationResponse`。
- `ChatStreamEvent` 增 `plan` / `elicitation-request` / `mode-update` / `commands-update`；`tool-approval-request` 增 `options`；`ChatToolApproval` 增 `optionId`；`ChatModelPort` 增 `respondToElicitation`。**全部加法式**，studio 不受影响。
- 适配器：`plan` 与追问走 assistant-ui 的 **data part**（名字常量 `PLAN_PART_NAME` / `ELICITATION_PART_NAME` 由本包导出，UI 两端共用，别各写一遍字符串）；计划整份替换、位置停在首次出现处；追问按 `elicitationId` 原地更新。`mode` / `commands` 不进消息内容（由会话控制器消费）。审批 `options` 直接透传（形状与 assistant-ui 的 `ToolApprovalOption` 一致）。
- 验证：chat 包 23 单测 ✅、chat `tsc` ✅、studio `tsc` ✅。

### ✅ WS-0 收尾 · 租户身份 + 依赖 — `ba9e7717`

- client 此前**没有租户概念**：补齐三层（`utils/tenant.ts` 只放值给 http 同步读 / `apis/tenant.ts` 打 `/tenants` / `features/quota/tenant.ts` 管解析与作废），`http.ts` 请求带上 `X-Tenant-ID`，入口 `watchActiveTenant()` 跟随令牌变化重解析。缓存一律带「解析时令牌」指纹，换账号立刻失效。
- 补 client 依赖：`@assistant-ui/react`、`assistant-stream`、`@i-thinking/types`。

### ✅ PR3 · 持久化域统一 `agent_*` — `762e43f1`

- 表 / 实体 / 模块 / 命令 id / 通道常量 / TS 类型全量改名，**全仓已无 `Ai*` / `ai*` 标识符**（Rust 侧 170 处、TS 侧 110 处）。
- 表名 snake_case（`agent_session` / `agent_message` / `agent_provider` / `agent_workspace` / `agent_workspace_folder`），索引外键 `idx_agent_*` / `fk_agent_*`，列名仍 camelCase；就地改 v001 单世代迁移。
- TS 类型在 `MagneticTile.Agent` 命名空间内用短名（`Session` / `Message` / `Workspace` / `WorkspaceFolder` / `Usage`），store 不再「旧名再导出」。
- 纯增量：`agent_session.providerID`、`AGENT_USAGE` 通道族、`Agent.Usage` 类型。
- 删掉 `packages/shared/src/types/magnetic-tile-agent.ts`（与 `.d.ts` 同名的副本、无人 import → 双轨），包 `exports.types` 改指 `.d.ts`。
- 执行方式：rust-analyzer 不可用 → 用显式有序映射表脚本改名（长名优先、camel/snake/类型分开），随后 `cargo check` + `tsc` 验证。
- 验证：`cargo check` ✅、client `tsc` ✅、lint 0 error ✅、单测 126 ✅、根 `lint` 13/13 ✅。

### ✅ 门禁补齐（`react-doctor` / catch 全域 / CI）

- **`react-doctor` 确实在用** → 根 devDeps 加 `react-doctor@0.9.17`；`doctor.config.ts` 从 `globalIgnores` 移除，纳入 `tsconfig.node.json` include 与 `client/node-tooling` 块。`tsc` + lint 均绿。
- **catch 存量清零 + 全域提级**：29 处（24 文件）`ith/catch-must-report` 清零 —— 真·良性分支 → `console.debug`，真异常 → `console.warn`；client 的规则块合并为单块全域 `error`（与 studio 对齐）。
  - 坑：**disable 注释必须放在 `} catch (…) {` 的上一行**——规则报在 `CatchClause` 起点（`catch` 关键字处，列号 9），写在 body 里不生效（`errors.test.ts` 两处刻意取异常断言就是这么踩的）。
- **CI**（`.github/workflows/continuous-integration.yaml`）：
  - `unit` 步骤改为 **client 硬失败**：`pnpm --filter @i-thinking/client run unit` 在前，其余包 `turbo run unit --continue --filter=!@i-thinking/client || true` 兜底。
  - 新增独立 job **`client-rust-check`**：`dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache`（`workspaces: apps/client/src-tauri`）+ webkit2gtk 系统依赖 → `cargo check --locked`。
  - `build.rs` 会 `panic` 于 `binaries/{corex-daemon,corex-mcp,goose}-<host>` 与 `binaries/pdfium.dll` 缺失/为空，故 job 内用**同名占位文件**满足（真实产物要联网 `pnpm command sidecar bootstrap client`，`cargo check` 不需要）。
- 验证：client lint `0 error`（全域 error 下）、client `tsc` 0、client unit 126/126。

### ⚠️ PR3 有意未做的部分（随 PR4 落地）

`agent_message` 的 `parentID` / `format`、删除 `thinking` / `parts`、`deleteMessages` 按 `parentID` 级联、`agent_usage` 的完整 CRUD —— 这些是**破坏性列变更**，会直接砸坏 PR4 才替换掉的旧消息 UI（`chat.tsx` / `workbench*` / `bubbles`），而新 UI 此刻还不存在，无法单独提交为绿。故与 PR4 同批做。

---

## 待决策（已全部拍板）

> 原表格已按答复收敛，结论如下（PR4 开工前无遗留阻塞项）。

| # | 结论 |
| --- | --- |
| 1 | **PR3 破坏性列变更随 PR4 同批**：`agent_message` 的 `parentID`/`format`、删 `thinking`/`parts`、级联删除、`agent_usage` CRUD 与新消息 UI 一起落地（单独提交只能留红）。 |
| 2 | **`magnetic-tile-agent.ts` 保持删除**（与 `.d.ts` 同名的孤儿副本 = 双轨）。 |
| 3 | **CI 已加独立 job `client-rust-check`**：`dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache` + webkit2gtk 依赖 + `cargo check --locked`，不塞进现有 job。`build.rs` 只校验 `binaries/*` 存在且非空，故用同名占位文件满足（真实产物要联网 bootstrap，`cargo check` 不需要）。 |
| 4 | **catch 存量清零 + client 全域 `error`**：29 处已清零，规则改为单块全域 `error`；测试里刻意取异常的两处用带理由 disable——**注释必须放在 `} catch (…) {` 的上一行**（规则报在 CatchClause 起点，不是 body 内），`console.debug` 用于「真·良性」分支。 |
| 5 | **`react-doctor` 确实在用**：保留 `apps/client/doctor.config.ts`，根 devDeps 加 `react-doctor@0.9.17`，从 `globalIgnores` 移除并纳入 `tsconfig.node.json` include 与 `client/node-tooling` 块（`tsc` + lint 均绿）。 |
| 6 | **`X-Tenant-ID` 链路 = 声明式 provider 静态 header**（我决策：按原建议，不引入本地代理）：租户切换 → `providers/custom/update`；JWT 文件 `<appData>/cogito/jwt`；helper 路径 Tauri 注入。已写入「决策（已定）」。 |
| 7 | **CI `unit` 改为 client 硬失败**：`pnpm --filter @i-thinking/client run unit` 在前，其余包 `turbo run unit --continue --filter=!@i-thinking/client || true` 兜底。 |
| 8 | **PR4 顺序按 D9，分 3 个提交**：① `port/history` + `acp/stream`（含 D2 映射单测）② `acp/session` + `port/{model,instance}` ③ `chat.tsx` 三栏/槽位移植 + 旧 UI 与死代码删除 + PR3 遗留破坏性列变更。 |
| 9 | **ACP SDK 无需升级**（实测 `@agentclientprotocol/sdk@1.7.0`）：`SessionUpdate` 已含 `plan`、`available_commands_update`、`current_mode_update`、`usage_update`（另含 `plan_update`/`plan_removed`/`compaction_update`/`compaction_summary_chunk`/`subagent_update`/`notice`/`session_info_update`/`config_option_update`）；`CreateElicitationRequest`（form/url 模式 + session/request scope）与 `ElicitationSchema` 齐备。 |
