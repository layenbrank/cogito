# 在线模型接入 + agent 平台化 调研

> **文档状态**：§1–6 是 P0 期的调研与计划记录（openCode v2 / Effect 路线，尚未落地，部分结论未采用）；
> **已落地的事实以 §7 为准** —— 对话链路只有一条，agent 运行由 studio 内嵌的
> [`opencode serve`](../../../apps/studio/src/host/capabilities/opencode/engine.ts) 承担
> （主进程 [`host/capabilities/assistant/index.ts`](../../../apps/studio/src/host/capabilities/assistant/index.ts) 只做 Electron 装配），
> `packages/agent` 是**契约包**（类型 + 归一函数），不是运行时。

> 关联实施计划：`C:\Users\MACHENIKE\.qoder-cn\plans\solemn-shore-quail.md`
>
> ⚠️ 本文基于 opencode v2 公开架构与文档目录结构整理；**文档原文因实施时网络受限未能联网核对**，
> 标注「待核实」处需在 P1 前对照 `https://opencode.ai/v2/docs/**` 钉死。

## 1. 目标

为 `apps/studio`（Electron 客户端）、`corex`（Rust 工具运行时）、`cogito`（Rust 后端）补齐企业级在线模型接入：

1. **BYOK 云供应商**：OpenAI / Anthropic / DeepSeek / Qwen / 智谱，密钥托管、流式、模型列表。
2. **托管网关**：Rust `cogito` 提供托管模型 + 企业管控。

已确认边界：agent 运行时 = TS + Effect（内嵌 studio 主进程）；corex = MCP 工具提供者；后端统一在 Rust `cogito`；全套对齐 opencode v2；禁用 ACP v1（`@agentclientprotocol/sdk@1.3.0` + goose WSS）。

## 2. opencode v2 架构映射

| opencode v2 文档                                             | 内容                                      | 本项目落点                    |
| ------------------------------------------------------------ | ----------------------------------------- | ----------------------------- |
| `/build/sdk/effect/`                                         | Effect 版 SDK：Agent / AgentHandle / Tool | `packages/agent` 核心         |
| `/build/client/effect/`                                      | Effect 版程序化客户端                     | 渲染↔主进程桥 / 测试          |
| `/build/plugins/effect/` + `/build/plugins/rpc/`             | 插件系统 + RPC                            | `packages/agent` 插件层       |
| `/providers/`                                                | 模型供应商注册表                          | 在线模型 BYOK                 |
| `/tools/`、`/mcp-servers/`                                   | 工具 + local/remote MCP                   | 内置工具 + corex-mcp          |
| `/permissions/`、`/skills/`、`/attachments/`、`/references/` | 权限/技能/附件/引用                       | agent 能力面                  |
| `/cli/acp/`、`/api`                                          | ACP server + HTTP API                     | agent 对外暴露 + service 网关 |

Effect 在 agent 运行时里承担：依赖注入（Provider/Config 作环境）、类型化错误、资源生命周期（MCP 连接）、并发流。

## 3. ACP v2 协议面（`/cli/acp/`）

- 传输：stdio（JSON-RPC 2.0）为主，HTTP/SSE 用于远程。
- client→agent：`initialize`（protocolVersion / capabilities / authMethods）、`authenticate`、`session/new`、`session/load`、`session/prompt`、`session/set_mode` / `set_model`、`session/request_permission`。
- agent→client：`session/update`（`user_message_chunk` / `agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `plan` / `current_model_update` / `available_models_update`）。
- 可选：`fs/read_text_file` / `write_text_file`、`terminal/*`（client 声明 capability 后 agent 回调）。

> 待核实：方法名与 `session/update` 具体字段以 opencode v2 文档原文为准。

## 4. 竞品对比

| 维度     | Cursor                                  | VS Code GitHub Copilot                                               | Qoder CN（本产品）                                                               |
| -------- | --------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 模型接入 | 订阅模型 + BYOK（自带 Key，应用内加密） | GitHub OAuth，多模型（GPT/Claude/Gemini）；企业 BYOK（Azure OpenAI） | 组织模型走 Cogito 服务网关 + JWT；我的模型是本机 BYOK provider（同一运行链路） |
| 密钥     | 本地加密存储                            | GitHub 托管（个人）/ 企业集中（BYOK）                                | 现无云端密钥管理                                                                 |
| 企业     | SSO、组织模型开关、用量分析、审计       | SSO/SCIM、组织策略、审计、IP 保障                                    | 缺（本次补齐）                                                                   |

结论：三家共同点是**自带 Key 云供应商 + 组织级模型白名单 + 用量/审计 + SSO**。

> 待核实：各家具体参数（上下文窗口、定价、白名单粒度）联网恢复后补全。

## 5. 版本钉定（待核实）

| 依赖                           | 现状                                                 | 待办                                                      |
| ------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| `effect`（+ `@effect/schema`） | 未进 catalog                                         | P1 前联网查最新稳定版，加入 `pnpm-workspace.yaml` catalog |
| ACP TS SDK                     | 仓库仅有 v1 `@agentclientprotocol/sdk@1.3.0`（禁用） | 确认 v2 SDK（或按 spec 手写 JSON-RPC）                    |
| Rust ACP / MCP crate           | corex 用 `rmcp` 3.4                                  | P2 复核 rmcp 是否够用或需 ACP crate                       |

## 6. 当前产物

`packages/agent`（契约包：纯 TS 类型 + 归一/分派函数，环境无关）：

- `provider.ts` — ModelID / Provider / Model / ProviderKind / `ProviderPreset`（含这一家开箱可用的
  `models` 预填清单）+ `PROVIDER_PRESETS`，外加来源与凭据分派（`ProviderSource` / `CredentialKind`）、
  `ModelEntry` 声明（能力 + 上下文窗口）与归一函数
- `message.ts` — Role / Message / Part（text|image|file|reasoning|tool）
- `tool.ts` — JsonSchema / Tool / ToolResult / ToolContext
- `permission.ts` — PermissionDecision / PermissionMode / PermissionRequest / PermissionReply
- `events.ts` — SessionUpdate（对齐 ACP session/update）
- `agent.ts` — AgentDefinition / PromptInput / SessionState / AgentHandle
- `skill.ts` — Skill / Attachment / Reference

实际落地**未走 Effect 路线**，也没留在主进程自己跑循环：agent 运行链路交给了**内嵌的 opencode 本体**
（§7.4），主进程只把 provider/凭据喂给它、把事件翻成端口协议、把审批权握在手里；
`packages/agent` 只做契约，`assistant-ui` 仍是渲染层。组织模型与我的模型共用这一条链路（见 §7）。

## 7. 落地进度

### 7.1 在线模型是 provider 表里的**一行**（`kind: 'gateway'`）

**不再有「在线通路 / 离线通路」两条链路，也没有 `chat.transport` 开关。**
网关就是个 OpenAI 兼容端点，跟 Ollama 没有形状差别；差别只有两点 —— 凭据从哪来、模型谁定 ——
分别由 `kind: 'gateway'` 与 `models` 两列表达。于是发送链路只有一条：

- `features/chat/runtime.tsx` 里只有一个 runtime（`useRemoteThreadListRuntime` + 一个
  `useLocalRuntime` + `ChatModelPort`）；`chat.transport` 开关、`@cogito/chat/adapters/online-transport`
  适配器、`transport-switch.tsx` 均已删除（旧配置键在读库时被丢弃，见
  [`stores/agent.ts`](../../../apps/studio/src/stores/agent.ts)）。
- **平台行**：[`features/chat/platform.ts`](../../../apps/studio/src/features/chat/platform.ts) 把
  `GET ${VITE_COGITO}/gateway/models` 的目录写成 provider 表里的固定一行：id `platform-gateway`、
  展示名「组织模型」、`baseUrl = ${VITE_COGITO}/gateway`。发送前 `ensurePlatformProvider()` 同步一次，
  与目录一致就不写库；网关不可用时返回 null、不落库。设置页对它是**只读**的。
  目录请求走渲染层 HTTP 客户端，会自动带上 `X-Tenant-ID`（见 §7.4）—— 早期版本**从不发这个头**，
  服务端只能按身份兜底，团队共享的模型会整批看不见。
- **凭据分派**：[`host/capabilities/assistant/model.ts`](../../../apps/studio/src/host/capabilities/assistant/model.ts)
  的 `resolveConnection` 是唯一分派点 —— `kind === 'gateway'` 用当前登录令牌（渲染进程经 `host.platformToken`
  传，≤4096 字符，不进钥匙串），并附带 `X-Tenant-ID`（配额归属，见 §7.4）；其余 provider 用 safeStorage
  里按 providerID 存的 BYOK 密钥。凭据最终写进 opencode 的 `provider.<id>` 配置，经
  `OPENCODE_CONFIG_CONTENT` 注入子进程，**不落 opencode 的 auth store**（那是明文 JSON）。
- **模型清单**：服务端目录下发 `name`（请求里 `model` 的值）、`label`、`capabilities`、`contextWindow`、
  `providerName`（上游供应商展示名 —— 用户看不到后台的供应商表，只能服务端下发）。缺省按契约兜底
  （[`packages/agent/src/provider.ts`](../../../packages/agent/src/provider.ts)：`tools` 默认开，
  `reasoning` / `vision` 默认关）。目录首项 `auto` 由**服务端补全**，客户端原样透传。
- **选模型**：[`features/chat/model-picker.tsx`](../../../apps/studio/src/features/chat/model-picker.tsx)
  分「组织模型 / 我的模型」两组，可按 `providerName` 搜索，标出「仅聊天 / 推理」；`Ctrl / ⌘ + /`
  循环切换（[`model-cycle.ts`](../../../apps/studio/src/features/chat/model-cycle.ts)，顺序与 picker 一致）。
  菜单顶部是**「自动」**（把 `chat.providerID` 置空）—— 不钉 provider，发之前现挑，见下条。
- **「自动」= 组织模型优先**：没钉住时由
  [`port/model.ts`](../../../apps/studio/src/features/chat/port/model.ts) 的 `findFallbackProvider` 决定 ——
  平台那行（`kind: 'gateway'`）排在 BYOK 之前，组内保持 IPC 顺序。于是「登录了就用组织模型、
  没登录 / 平台不可用就退回本机」是同一套推导，而不是两条链路。**唯一真源**：同一个文件里的
  `resolveTarget`（发什么）与 `findTargetLabel`（界面说什么）出自一处，模型选择器与右栏「生效模型」
  都读它，不自己拼文案 —— 否则右栏说的模型和真正跑的不是同一个。平台行由目录派生，
  退出登录后残留的那行会被 `dropStalePlatformRow()` 在读库时丢掉
  （不丢的话「组织优先」会挑中一个已经没有凭据的 provider，发送必失败）。
- **在线同样有工具、审批、计划**：在线模型与「我的模型」跑的是**同一条 opencode 链路**，工具与系统提示词
  都由 opencode 自己生成（studio 不下发 `body.tools` / `system`，工具可见性由档位对应的 agent 规则决定，
  清单见 [`shared/agent-tools.ts`](../../../apps/studio/src/shared/agent-tools.ts)）。网关的 `ChatCompletionsP`
  用 `#[serde(flatten)] extra` 把上游请求里的 `tools` / `system` 原样透传，只负责鉴权与配额。
  是否给工具只看模型能力（[`features/chat/port/instance.ts`](../../../apps/studio/src/features/chat/port/instance.ts)：
  `capabilities.tools === false` 时走**纯聊天档** `studio-chat` —— 一个工具都不给）。
- **失败信封**：网关失败一律 **HTTP 200 + `{code, success:false, msg}`**。它现在落在 _opencode_ 的
  provider 请求里，所以「把 `msg` 挖出来」这一步在 studio 侧有两处兜底：
  [`opencode/events.ts`](../../../apps/studio/src/host/capabilities/opencode/events.ts) 的 `describeOpencodeError`
  从错误报文里截出 JSON 信封取 `msg`（opencode 会把整段信封塞进错误消息）；
  [`host/capabilities/assistant/protocol.ts`](../../../apps/studio/src/host/capabilities/assistant/protocol.ts) 的
  `findErrorMessage` 再补一句可操作的提示（如配额触顶时指向「设置 → 额度」）。

服务端前提：`/gateway/models` 至少要有一条可路由的 `enabled` 模型（`auto` 排首位，但它本身需要候选），
否则选择器为空、发送前提示未选择模型。

### 7.2 管理面（供应商 / 模型 / 用量 / 审计，管理员可见）

服务端 `/gateway` 下的管理路由已全部可达（早期版本 `module.rs` 里两段内层 `web::scope("")` 并列，
actix 只匹配第一段，管理面一律 404；现已改成单个 `scope("/gateway")`）。studio 侧：

- 客户端：[`apps/studio/src/apis/gateway.ts`](../../../apps/studio/src/apis/gateway.ts) —— 目录 + 管理面 CRUD + 用量/审计，
  `kind`/`status` 的中文标签也在这里。
- 入口：设置页（`/agent/settings`）的「平台」分组，仅 `isAdmin()` 为真时出现
  （[`utils/auth.ts`](../../../apps/studio/src/utils/auth.ts) 解 JWT payload 的 `role`，必须精确 `ADMIN`）。
  非管理员即使手改路由也拿不到数据：服务端回 `300006 权限不足`。
- 四个页面：`sections/platform-providers.tsx`（上游 + 密钥托管）、`platform-models.tsx`（目录条目、
  可见角色、日配额、能力声明与上下文窗口）、`platform-usage.tsx`（会话用量 + 时间/模型/租户筛选）、
  `platform-audit.tsx`（变更与调用流水）。列表排版复用 `components/table.tsx`。
  模型页的表单会显式写回 `capabilities: {tools, reasoning, vision}` 与 `contextWindow`（表单即权威，
  空窗口 = 清空），表格里有「能力」「上下文」两列；内置 `auto` 由服务端注入、排首位，不需要也无法在这里维护
  （同名模型会被服务端拒为 `200003`）。

| 接口                             | 角色  | 说明                                                       |
| -------------------------------- | ----- | ---------------------------------------------------------- |
| `GET/POST /gateway/providers`    | ADMIN | `PUT/DELETE /gateway/providers/{id}`；密钥只回 `hasApiKey` |
| `GET/POST /gateway/admin/models` | ADMIN | `PUT/DELETE /gateway/admin/models/{id}`；列表不过滤停用项  |
| `GET /gateway/usage`             | ADMIN | `tenantID`/`modelID`/`from`/`to` + 分页                    |
| `GET /gateway/audit`             | ADMIN | `tenantID` + 分页                                          |

分页信封 `Paginated<T>` 的 `page` 从 **1** 起，`count` 是总条数、`total` 是总页数（服务端内部
sea-orm `fetch_page` 是 0 起的，之前少了 `-1`，导致 `count` 有值而 `items` 恒为空）。

### 7.3 agent 运行时 = 内嵌的 opencode 本体

职责边界（这条边界是本次重构的核心，见 [architecture.md](./architecture.md) §4）：

| 层                                             | 负责                                                        | 不负责              |
| ---------------------------------------------- | ----------------------------------------------------------- | ------------------- |
| 渲染层（`views/agent`、`features/chat`）       | 对话 UI、模型选择器、审批弹窗、变更卡、额度页               | 不碰任何 agent 循环 |
| 端口（`features/chat/port/*`）                 | 把 UI 意图翻成端口消息，`MessagePort` 回传事件              | 不认识 opencode     |
| 主进程装配（`host/capabilities/assistant/index.ts`） | 只做 Electron 侧接线：密钥库、IPC、MessagePort              | 不实现运行时        |
| 运行时（`host/capabilities/opencode/*`）       | 内嵌 `opencode serve` + SDK：循环、工具、压缩、快照、子任务 | 不管登录/计费       |

**进程与配置**

- 二进制只认两个来源：`OPENCODE_BINARY`（开发期，**优先于**缓存的 lock 版本）、sidecar staging
  （`pnpm sidecar stage studio` 落盘、打包时随包发出）。**不扫 PATH** —— 用户自装的 opencode
  版本未知，连上去只会以奇怪的协议错误失败。
- **版本漂移必须响亮失败**：`tools.lock.json` 里的 pin 是唯一真相，缓存命中不是「有文件就算」
  而是「有 lock 里那个版本」——落盘目录留 `.version` 记号，`ensureOpencodeVendor` 还额外跑
  `opencode --version` 与 pin 交叉核对（不符直接抛错，读不到版本只 warn）。缺了这道核对，
  v1 二进制会以「协议错误」而不是「版本不符」暴露出来（实测 v2 SDK 打 v1 server：`prompt`
  被拒 `InvalidRequestError: Missing key at ["prompt"]`，`session.diff` 报 `UnsupportedContentType`），
  排查方向会跑到协议层上去；见 [troubleshooting.md](./troubleshooting.md)。
- studio 不用 SDK 的 `createOpencodeServer()`，而是自己 spawn（[`opencode/server.ts`](../../../apps/studio/src/host/capabilities/opencode/server.ts)）：
  `--port 0` 实测会落到固定 4096，所以先用 `net` 探一个空闲端口再传；`--hostname 127.0.0.1`。
- **数据目录必须隔离**：opencode 默认写 `~/.local/share/opencode`，那可能是用户自己的会话库
  （实测直接连上去会因 `Database is not empty and has no session table` 启动失败）。studio 把
  `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME` 全部指到
  `<userData>/opencode/*`（Windows 上同样生效）。
- **用户自己的库可以原地升级**：studio 目录里若留着旧版本建的库（v1 的 38 条迁移 + 旧 session 行），
  v2 启动时会**增量跑完剩下到 48 条迁移并照常工作**（实测跑完整轮对话，旧 session 行仍在），
  不需要让用户删库。真正会炸的是「去连用户主目录那个不属于 studio 的库」。
- spawn 时设 `NO_PROXY=127.0.0.1,localhost,::1`：本机系统代理会吞掉 127.0.0.1 的请求。
- 配置经 `OPENCODE_CONFIG_CONTENT` **内联注入**（凭据不落 opencode 的明文 auth JSON）。
  代价是**改配置必须重启 server**（实测配置不热重载，`config.update` 也只改内存视图）。
  因此按 `toConfigSignature(config)` 复用/重启：**换模型不重启**（配置里写全所有可用 provider），
  换 provider / 换凭据 / 换租户才重启（重启会打断在跑的那次运行）。
- 每个 studio provider 都映射成 `@opencode/ai/providers/openai-compatible`（studio 的 preset 本来全是 OpenAI
  兼容端点，唯一的 Anthropic 在 preset 里已标不支持）。模型能力（`capabilities.tools` / `input` / `output`）
  与上下文窗口一并写进配置，opencode 据此决定收不收图片、给不给工具。
- 鉴权：`OPENCODE_SERVER_PASSWORD`（随机 24 字节）→ SDK 侧 Basic `opencode:<pw>`。

**运行链路**

- `client.event.subscribe({ signal })`：v2 只有**一条全局事件流**（信封是 `{id, created, type, data}`，
  v1 的 `properties` 已不存在），进程活着就一直收，不再按目录各开一条。引擎按 `sessionID` 把事件路由回
  登记的运行；流断了就把订阅置空，下一次运行重建。
- 会话映射持久化在 electron-store（`opencode-sessions`，键 = studio 线程 id → `{sessionID, directory}`），
  应用重启后接着聊，opencode 那边还认得这段历史。
- 新会话时把工作区路径、根清单与 `@` 引用（`attachments` → `file://`）拼进首条 prompt；系统提示词不再由 studio 拼，
  归 opencode 的 agent（见下）。
- 终态有三个出口（`session.idle` / 运行结果 / abort），一律经幂等的 `settle()` 落地，
  `session.idle` 后再给 1.5s 宽限，避免把「还在吐最后一段」当成结束。
  **工具与权限**（[`shared/agent-tools.ts`](../../../apps/studio/src/shared/agent-tools.ts) 是单一事实源）

工具清单已对着 opencode 2.0.15 **实测重写**，模型可见 12 项，按「性质」分三类：

| 性质          | 工具                                                | 说明                                           |
| ------------- | --------------------------------------------------- | ---------------------------------------------- |
| `readonly`    | `read` `glob` `grep` `webfetch` `websearch` `skill` | 不改盘、不出网，三档都放行                     |
| `mutating`    | `edit` `write` `patch` `shell` `subagent` `execute` | 写盘 / 执行命令 / 派子任务 / 执行代码          |
| `unavailable` | `question`                                          | 产品禁用：serve 模式下没人能回答，模型会一直等 |

- 每个工具声明自己对应的 `permission` **`action`**（`edit` / `write` / `patch` 三个工具同属 `edit`），
  permission 规则与工具卡中文名都由它派生 —— 新增工具只改 `AGENT_TOOLS` 一处，三档规则自动跟上。
- 与 v1 的名字差异（实测，别凭直觉改）：`bash` → **`shell`**、`task` → **`subagent`**；
  `lsp` / `todoread` / `todowrite` / `invalid` / `list` 在 v2 里**根本不存在**。名字对不上时工具卡标题退化成
  英文原名、permission 规则落到兜底规则上（有副作用的工具会被悄悄放行），所以表里只放真实存在的名字。
- `patch` 是**条件工具**（模型直出补丁时才注册，本机只在部分 GPT 系模型上见到）、`execute` 对应 Code Mode：
  可用性由 provider / model 能力决定，留在表里是为了「名字对上就有中文标题、就有对应规则」，不是承诺可见。
- **工具可见性完全由 permission 决定**：v1 那种「请求体 `body.tools` 开关」（`buildToolDisables()`）在 v2
  已不存在，effect 落到 `deny` 的 action 直接**不进模型工具列表**（只读档实测只剩 `readonly` 那几项，
  `question` 因 deny 也不在其中；纯聊天档一个工具都没有）。规则随进程配置注入、不能热改，
  所以档位编译成自定义 agent（见下）。
- **兜底规则 `{ action: '*', resource: '*', effect: <mutating 的效果> }` 排在最前**：没点名的 action
  （MCP 工具是 `<server>_<tool>`、opencode 升级新增的动作）因此在 `ask` 档下会逐次确认、在 `readonly` 档下
  执行不了，不会因为「表里忘了写」而被静默放行。要正式支持某个工具，先在工具表里加行。

**审批（档位 = 自定义 primary agent）**

- v2 的 permission 是**有序规则数组**（`{action, resource, effect}`，**last match wins**，没命中默认 `ask`），
  而且**不能热改**（随 `OPENCODE_CONFIG_CONTENT` 注入，改了要重启 server、正在跑的那次会被打断）。
  所以 studio 把三个档位编译成 **3 个自定义 primary agent**（`studio-auto` / `studio-ask` / `studio-readonly`，
  外加纯聊天档 `studio-chat`），每轮运行前 `switchAgent` 切一下，server 全程不重启
  （见 [`opencode/permission.ts`](../../../apps/studio/src/host/capabilities/opencode/permission.ts)）。
- 这四个 agent **只写 `permissions`，不写 `system`**：写了 `system` 会整体替换掉 opencode 内置的编码 agent
  系统提示词（工具说明、编辑规范一起没）。档位是权限问题，不该顺手把提示词也换掉。
- 于是档位判断只在配置里发生一次：`auto` 直接 allow、`readonly` 直接 deny（模型连工具都看不到），
  服务端**只会在真需要人拍板时才问**。主进程的 `answerPermission` 只做三件事：找到归属的运行 →
  问渲染层 → 把回执发给**提问的那个会话**（子代理自己起的会话按 `parentID` 上溯；找不到就 fail-closed 拒绝，
  不让服务端干等）。
- `permission.asked` → 端口事件 `tool-approval-request` → 渲染层弹窗 → 回传端口消息
  `{kind: 'tool-approval', runID, toolCallId, approved}`。回执只有 `once` / `reject` 两态：`always` 会往项目里
  持久化一条 allow，而它**永远盖不过**配置里的 deny（用起来像「有时候有效」），所以不下发。
- 越界守卫 `external_directory` 不是工具：`auto` / `ask` 都先问一句，`readonly` 直接拒绝。
  审批等待上限 5 分钟，超时与 abort 一律按拒绝落地。
- **`.env` 在三档下都读不到**：opencode 的 base 策略里 `read *.env` 是 `ask`（`auto` 档会被直接放行），
  所以规则表末尾补三条 `read` 规则：`*.env` / `*.env.*` → `deny`、`*.env.example` → `allow`。
  显式 `deny` 之后 `read .env` 连审批都不弹（实测）；规则后者胜，所以这三条必须排在 `read *` 之后。

**工作目录与多根**

- 工作区与磁盘目录的解析**只有一处**：[`workspace/index.ts`](../../../apps/studio/src/host/capabilities/workspace/index.ts)
  的 `resolveWorkspaceTarget` / `resolveWorkspaceID`（未归档工作区 + 第一个存在的根 = 运行目录）。
  落库（`chat.ts`）与运行（`engine.ts`）都读它，渲染层传来的 null / 悬空 id 不再直接撞数据库外键、
  也不会再被当成 opencode 的 `directory`。
- 没有可用目录时**响亮失败**（`requireWorkspaceTarget`），不退回空沙箱：退化会让模型面对
  「看看 service」时从盘符根全盘搜，白烧 token 还常常找错树。
- opencode 一个会话只有一个工作目录，工作区里**其它根在它眼里都是「工作区外」**，所以两件事一起做：
  - 配置层：把**所有未归档工作区的根**写进 `external_directory` 规则（`permission.toExternalDirectoryRules`，
    排在越界守卫之后），多根不再每步弹一次审批。授权只解除越界守卫，动作级 `read` / `edit` 规则照旧独立生效
    （只读档不会因此获得写权限）。取「全部工作区根并集」而不是「当前工作区」，是因为配置改了要重启 server，
    按当前工作区算会让每次切工作区白重启一次。
  - 提示层：首轮 prompt 贴一份根清单（`session.toRootsPreamble`，只在该线程**还没有会话映射**时贴一次，
    opencode 自己的历史里有了就不再重复，别让模型每轮都重读一遍）。

**变更卡**

- 数据源是 v2 的 `session.diff({ sessionID })`（`opencode/changes.ts`）：一次给全量，不再逐条用户消息问
  （v1 不带 `messageID` 会恒返回空）。`changeID` = 工作区相对路径。
- **只有 git 工作区有变更记录**：opencode 的快照落在 shadow repo 里，plain 目录拿不到 diff，
  这时变更卡为空（不是 bug）。
- 撤销 = 把该条消息的 patch **逆向套用** + 删掉新增文件。不用 `session.revert`：studio 只想撤文件，
  不想连对话历史一起回滚。
- **diff 正文按需拉**：清单（`workspace:changes.read`）只给「哪个文件 + 增删行数」，正文另开一条
  `workspace:changes.patch`（入参 `changeID` = 工作区相对路径），**点开某个文件才拉**。清单是 1.2s
  一轮的轮询，把 patch 一起塞进清单等于每轮都白搬几万字符。超长 patch 在主机侧按 `PATCH_MAX_CHARS`
  截断（尾部补提示行），不把一个文件撑成十几万字符的 IPC 载荷。
- **解析在渲染层**（[`diff-lines.ts`](../../../apps/studio/src/views/agent/chat/components/diff-lines.ts)，
  单测同目录）：两个坑各有一条不变量 —— ① 文件段**不能靠前缀切**（hunk 正文里就可能出现
  `diff --git a/x` 这样的删除行），只能按 hunk 头声明的行数预算判断 hunk 结束；② git 对非 ASCII 路径
  用 **C 风格八进制转义**（`"a/\344\270\255.md"`），`JSON.parse` 解不开，得自己按字节解码再还原 UTF-8。
- 预览默认只画 200 行正文（文件头与 `+N −M` 始终按完整 patch 统计），超出部分给「展开剩余 N 行」。

### 7.4 免费用量 / 付费用量（配额 + 订阅）

**边界**：判定与守门全在服务端（网关的 `QuotaExceeded` = `400006`）；studio 只做三件事 ——
展示、提供加量入口、发送前**提前告知**。

- **自助读取走 `GET /gateway/quota/me`**（登录即可读，不需要管理员）：回 `scope`（`TENANT` / `USER`）、
  `source`（`MODEL` / `PLAN` / `FREE` / `GLOBAL`）、`plan`、`limit`、`used`、`remaining`、`exhausted`、
  `resetsAt`，数字全部来自服务端。带 `?model=` 时按该模型的覆盖口径回答 —— 正是发送前判定要用的那一个数。
  服务端把 `X-Tenant-ID` 当**选择器**：不是该租户成员就 `300007`（403），不带则按账号（`USER`）作用域回答，
  所以「先带对租户」仍然重要。
- **归属靠 `X-Tenant-ID`**：网关按这个请求头决定配额算到谁头上。不带 → 服务端按用户身份兜底，
  **订阅档位永不生效**（服务端的配额解析只有「个人租户 + 有效订阅且档位存在」才给 PLAN）。
  租户 id 由 `GET /tenants` 里 `type === 'PERSONAL'` 的那条决定，缓存 5 分钟并**带登录令牌指纹**
  （换账号/退登立刻失效，绝不把配额记到别人租户上；指纹记的是**发起解析时**的令牌，
  解析途中换了账号就把结果丢掉、下次为新账号重解析）。注入点有两条：
  - 渲染层的 HTTP 客户端：[`utils/http.ts`](../../../apps/studio/src/utils/http.ts) 的 `onRequest`
    对 `/gateway/*` 且 `isCogitoUrl` 命中自家 API 的请求统一补 `X-Tenant-ID`，值从
    [`utils/tenant.ts`](../../../apps/studio/src/utils/tenant.ts) 的值缓存**同步**读出
    （解析与写入在 [`features/quota/tenant.ts`](../../../apps/studio/src/features/quota/tenant.ts)；
    值缓存放 `utils/` 是为了避开 `apis/* → http.ts` 的循环引用）。
  - agent 运行链路：渲染层 `syncActiveTenant()`
    → `port/model.ts` 的 `findTarget`（发送链路里唯一的异步节点）→ `port/instance.ts`
    → `assistant/protocol` 的 `host.tenantID` → `assistant/model.resolveConnection` 产出
    `headers: { 'X-Tenant-ID': … }` → `opencode/config.ts` 写进 `provider.<id>.options.headers`
    → opencode 原样透传给上游（**已实测**：只打 `/chat/completions`，不打 `/models`）。
    租户头只给平台网关；本机 BYOK provider 与第三方域名都不写（`Authorization` 同样只发自家接口）。
- **限额优先级**：模型级 `dailyTokenQuota > 0` 覆盖租户档位；`source` 与 `plan` 直接由服务端给出，
  studio 不再自己推档位。
- **已用量不再由 studio 汇总**：服务端把计数记在 Redis
  （`gateway:quota:{scope}:{id}:{yyyy-mm-dd}`，UTC 日窗、与模型无关），`/gateway/quota/me` 的 `used`
  就是这份计数，`resetsAt` 是下一个 UTC 零点。早期版本让 studio 去 `GET /gateway/usage` 翻页近似，
  而那个接口挂在 **`Auth::admin()` 上**，普通账号只会拿到 `300006 权限不足`，界面只能写「暂不可得」；
  这条路径与 `apis/quota.ts` 里的汇总工具（`findUsedTokens*` / `findUtcDayStart` 等）已一并删除。
- **发送前门禁**（[`features/quota/gate.ts`](../../../apps/studio/src/features/quota/gate.ts)）：
  只拦平台网关（BYOK 直连上游，不经服务端配额）；一次 `GET /gateway/quota/me`
  （有目标模型就带 `?model=`，否则问身份级），**信服务端的 `exhausted`**、不自己比大小；
  结论缓存 60s（key = `租户:模型`；**失败也缓存**，否则断网时每发一条都打一次接口），
  订阅/取消后 `clearQuotaCheck()` 立即作废；判定原则是**算不准就放行** —— 没有租户身份、接口不通，
  一律交给服务端。拦下时端口首条事件就是 `error`，文案带上「设置 → 额度」的去处。
- **订阅（写）**：`POST /tenants/{id}/subscriptions`（body `{plan, expiresAt?}`，毫秒时间戳、缺省 = 永久；
  创建即生效并顶掉该租户其它 ACTIVE 订阅）、`DELETE /tenants/{id}/subscriptions/{subscriptionID}` 立即取消、
  配额回落免费档（今日已用量不清零）。团队租户不可订阅。
  **这个自助入口只对未定价档位开放**：服务端 `pay.plans[plan].amount > 0` 时返回 `500408`，防止租户 OWNER
  （个人租户里就是用户本人）绕过收银台白拿付费档位；已定价档位只能由服务端**收到渠道回调、验签并核对金额之后**
  开通。平台管理员保留「直接开通」（客服代开与本地联调），它走同一条 `subscribe`，服务端对管理员放行。
- **购买（收银台）**：价格与时长**只在服务端**（`pay.plans`），客户端从不提交金额。客户端
  （[`apis/payment.ts`](../../../apps/studio/src/apis/payment.ts)）只做四件事 —— 读目录、下单、查单、关单：
  下单 body 只有 `{plan, channel}`；返回的 `codeUrl`（微信 `weixin://…` / 支付宝 `qr.alipay.com/…`）由
  [`checkout-dialog.tsx`](../../../apps/studio/src/views/agent/settings/components/checkout-dialog.tsx)
  用 `qrcode.react` **本地**渲染成二维码，`orderExpiresAt` 驱动倒计时；
  `sync` 是回调丢失时的兜底 / 「刷新支付状态」按钮的实现（客户端无从自行宣布「已支付」，仍由服务端向上游查单核销）；
  `close` 只在用户主动取消时调用。渠道凭据没配好时目录里 `enabled=false` 并带原因，界面如实置灰、不摆假二维码。
- **界面**：设置页「个人」分组的「额度」页
  （[`sections/quota.tsx`](../../../apps/studio/src/views/agent/settings/sections/quota.tsx)）——
  额度段（计费归属 / 配额来源 Badge（模型覆盖会标出模型）/ 日配额上限 / 今日已用 / 重置时刻 /
  剩余进度条与触顶提示；加载态骨架，读取失败给 `HttpError` 文案 + 重试）+ 订阅段（生效订阅 / 取消）+
  **购买档位段**（档位卡：价格 · 日配额 · 时长；`purchasable=false` 显示服务端给的原因；「去支付」进收银台）+
  **订单历史段**（最近 20 笔：订单号 / 档位 / 渠道 / 金额 / 状态 / 时间，回调丢失时可进收银台手动查单）。
  左栏底栏有**额度入口**（[`quota-menu.tsx`](../../../apps/studio/src/views/agent/chat/components/quota-menu.tsx)，
  与账号、设置并列；未登录显示登录引导），显示今日用量百分比，点「用量、档位与订单」跳设置页额度段
  （`?section=quota` —— 设置页支持 `?section=` 直达，模型入口也用它跳到 `?section=model`）。
  档位目录为空时提示服务端还没配 `pay.plans`。

| 接口                                                  | 角色        | 说明                                                                            |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `GET /gateway/quota/me`                               | 登录用户    | 我此刻的配额（`?model=` 支持模型覆盖；只读、不计费）                            |
| `GET /gateway/plans`                                  | 登录用户    | 档位目录 + 免费档日配额基线                                                     |
| `GET /tenants`                                        | 登录用户    | 我所属的租户；注册时自动建个人租户                                              |
| `GET /tenants/{id}/quota`                             | 租户成员    | 生效档位与日配额；服务端保留（studio 已无调用者，被 `/gateway/quota/me` 取代）  |
| `GET /tenants/{id}/subscriptions`                     | 租户成员    | 该租户的订阅（含已失效的）                                                      |
| `POST /tenants/{id}/subscriptions`                    | OWNER/ADMIN | `{plan, expiresAt?}`；创建即生效，**仅未定价档位**（已定价 → `500408`）         |
| `DELETE /tenants/{id}/subscriptions/{subscriptionID}` | OWNER/ADMIN | 立即取消                                                                        |
| `GET /tenants/{id}/pay/catalog`                       | 租户成员    | 可售档位（定价 / 时长 / 日配额 / `purchasable` + 原因）与渠道可用性             |
| `POST /tenants/{id}/orders`                           | OWNER/ADMIN | 下单：`{plan, channel}` → `codeUrl`                                             |
| `GET /tenants/{id}/orders`                            | 租户成员    | 订单历史（服务端返回最近 20 笔）                                                |
| `GET /tenants/{id}/orders/{orderNo}`                  | 租户成员    | 订单详情（顺带惰性关单）                                                        |
| `POST /tenants/{id}/orders/{orderNo}/sync`            | 租户成员    | 主动查单（回调兜底 / 刷新支付状态）                                             |
| `POST /tenants/{id}/orders/{orderNo}/close`           | OWNER/ADMIN | 关闭订单（用户取消；已支付不可关闭）                                            |
| `GET /gateway/usage`                                  | ADMIN       | 用量明细（`tenantID`/`modelID`/`from`/`to` + 分页）；只在管理面「平台用量」使用 |

客户端在 [`apis/gateway.ts`](../../../apps/studio/src/apis/gateway.ts)（`GET_GATEWAY_QUOTA_ME` /
`GET_GATEWAY_PLANS`）、[`apis/quota.ts`](../../../apps/studio/src/apis/quota.ts)（租户 + 订阅）与
[`apis/payment.ts`](../../../apps/studio/src/apis/payment.ts)（目录 + 订单），
纯计算在 [`features/quota/quota.ts`](../../../apps/studio/src/features/quota/quota.ts) 与
[`features/payment/checkout.ts`](../../../apps/studio/src/features/payment/checkout.ts)，
react-query hooks 在 [`features/quota/usage.ts`](../../../apps/studio/src/features/quota/usage.ts) 与
[`features/payment/orders.ts`](../../../apps/studio/src/features/payment/orders.ts)。

> **上线前服务端侧要准备**：微信（商户号 + Native 支付、APIv3 密钥、商户 API 证书、平台证书公钥）与
> 支付宝（开放平台应用 + 当面付、应用私钥 / 支付宝公钥）的凭据，以及**公网 HTTPS 回调域名**
> （微信/支付宝必须能访问 `/api/v1/pay/notify/*`）。清单与字段见 service 仓库
> `src/services/payment/README.md` 与 `guide/configuration.md` 的「支付（微信 / 支付宝）」小节；
> 本机收不到回调时用内网穿透，或直接点收银台「刷新支付状态」走 `sync`。

### 7.5 用量账本（本机账，studio 自己记）

**两条口径，分工明确**：服务端的 `used`（§7.4）是**组织模型**花掉的量 —— 只有服务端算得准；
本机 BYOK 与本机运行时不过服务端，只能由 studio 自己记，这张表就是那份账。

- **一次运行一条**：表 `chatUsage`（[`drizzle/schema/chat.ts`](../../../apps/studio/drizzle/schema/chat.ts)，
  迁移 `0001_chat_usage.sql`），字段 `runID` / `sessionID` / `providerID` / `model` / `source` /
  `outcome` / 三个 token 数 / `createdAt`。只增不改，`runID` 唯一约束让重复结算无害
  （重连 / 重试导致的终态重放不会重复计数）。
- **写入点唯一**：引擎的 `settle()`
  （[`opencode/engine.ts`](../../../apps/studio/src/host/capabilities/opencode/engine.ts)）—— 终态
  （`finish` / `aborted` / `error`）的唯一汇聚点，**先记账再发终态**：反过来的话界面已经显示了用量、
  库里却还没有，刷新就归零。取消与失败同样记账（用户中途点停也花了钱）。
- **为什么不挂消息**：消息那条路（`metadata.custom.usage`）由 assistant-ui 的历史适配器落库，
  而**用户取消时它会把最后一轮结果丢掉**（见
  [`chat-model.ts`](../../../packages/chat/src/adapters/chat-model.ts)）—— 那正是「花了 token 却没算用量」
  的根源。账本与消息解耦，消息在不在都算数。
- **刻意不加外键**：`sessionID` / `providerID` 不引用 `chatSession` / `chatProvider` ——
  会话行还没落库（历史适配器的 `ensure()` 是异步的）不该让记账失败，删会话 / 删 provider 也不该让历史用量消失。
- **读**：`chat.usage.toRead({ sessionID })` → `{ session, today }`（每项形如
  `{ runs, inputTokens, outputTokens, totalTokens }`）。`session` 是本会话累计，`today` 是**全部会话**的
  今日合计（含没有会话归属的），所以两者不会相等 —— 有意的，账要对得上真正花掉的量。「今日」按**本地零点**切
  （与配额的 UTC 日窗不同，见 §7.4）。
- **界面**：右栏「用量」区块给本会话 / 今日两行；一轮运行结束（`isRunning` 由 true 变 false）时
  [`features/chat/usage.ts`](../../../apps/studio/src/features/chat/usage.ts) 的
  `useRefreshUsageOnRunEnd()` 主动失效账本与配额缓存 —— 不失效就一直显示运行前的数字。
  消息上标的用量（输入框底部栏）仍是消息口径，两者分开显示、不混算。

### 7.6 右栏「任务详情」（会话状态面板）

Agent 窗口是三栏（左栏任务列表 / 中栏对话 / 右栏任务详情），对齐 Qoder 的「任务详情」与 Cursor 的
会话边栏。右栏只**读**当前会话这一份任务的状态：配置类动作仍在左栏（换工作区）、输入区右下角
（换模型 / 访问权限）与设置页，右栏只多一件事 —— 撤销本会话改过的文件。

- **段落固定十段且恒渲染**：运行 / 计划 / 变更 / 引用 / 工具调用 / 用量 / 额度 / 模型与权限 /
  工作区 / 会话（[`aside.tsx`](../../../apps/studio/src/views/agent/chat/components/aside.tsx)）。
  顺序即 `AsideSection` 的取值；每段是一个 `AsideCard`，带 `data-aside-section` 作滚动锚点。
- **数据全部就地派生**（消息 + 本机账本 + 平台接口），不另存快照 —— 另存一份必然要在「谁是真源」上打架。
  派生逻辑收在纯函数层 [`features/agent/insight.ts`](../../../apps/studio/src/features/agent/insight.ts)
  （运行阶段 / 引用 / 工具统计 / 最后活动），因此刷新、切会话、重放历史天然一致。
- **变更清单的唯一权威在右栏**：逐文件撤销与「全部撤销」只在这里；
  消息流里的汇总条只说数量 + 「审阅」开右栏。两处共用
  [`features/agent/changes.ts`](../../../apps/studio/src/features/agent/changes.ts) 的查询键
  `['workspace','changes',sessionID]`，所以一边撤销另一边立刻跟着变。运行中按 1.2s 轮询，
  **运行结束再补一次**（`useRefreshOnRunEnd`，只在 true → false 的边沿触发）—— agent 常是「写完就收尾」，
  缺这一次刷新清单会少最后一个文件。
- **耗时为什么会话分账**：assistant-ui 的 `metadata.timing` 在本仓没有接线，助手消息的 `createdAt`
  又是**运行开始**时刻，两个都算不出一轮跑了多久，于是右栏只报**本窗口亲眼看到的**那一轮
  （`useRunClock(isRunning, threadID)`）；读数按线程键 `threads.mainThreadId` 打标，因为右栏在切换
  会话时不重挂载 —— 不带键会把 A 会话的时长显示到 B 会话头上。历史加载回来的会话没有这份数据就不显示。
- **跨组件开栏只有一个通道**：`AsidePanelProvider` + `useAsidePanel()`
  （[`aside-panel.tsx`](../../../apps/studio/src/views/agent/chat/components/aside-panel.tsx)；
  无 Provider 时整体退化成 no-op）。`open(section)` 顺带交一个滚动锚点，右栏滚完即 `clearFocus()`；
  有计划时 `PlanAsideOpener` 顶开右栏（按**计划总量**记一次已开，用户手动收起后不会被同一次计划反复顶开）。
- **三个用量口径必须各自标名**：本机账本（§7.5，重启不清零）、平台额度（§7.4，只算平台模型，
  UTC 日窗）、消息里标的用量（历史会话没有账本记录时的兜底，实现在
  [`aside-usage.tsx`](../../../apps/studio/src/views/agent/chat/components/aside-usage.tsx)）。
  放到一起而不写清来源，用户必然把它们当同一个数。

### 7.7 会话界面：工具卡与左栏

#### 工具卡按工具性质分派，命令走**模拟终端**

对齐 Cursor / Qoder / Copilot 的会话区：命令执行不该是「一坨 JSON 参数 + 一坨 stdout」，而是终端面板。

- 分派是**表驱动**（[`tool-card.tsx`](../../../apps/studio/src/views/agent/chat/components/tool-card.tsx)
  的 `TOOL_VARIANTS`）：`shell` → 终端卡、`execute`（Code Mode）→ 源码 + 输出卡、其余 → 通用折叠卡。
  加工具只加表里一行，不改渲染分支。
- 终端面板（[`tool-terminal.tsx`](../../../apps/studio/src/views/agent/chat/components/tool-terminal.tsx)）
  恒深色（不跟随主题）：头部是 `$ 命令 · 工作目录 · 后台` 与运行 / 成功 / 失败状态，正文 `max-h-80`
  滚动、`font-mono`，超长输出默认折叠并给「展开全部」。
- 取数收在纯函数层 [`tool-output.ts`](../../../apps/studio/src/views/agent/chat/components/tool-output.ts)
  （`toShellCommand` / `toCodeSource` / `collapseOutput`，带单测）：`execute` 的源码键没有稳定承诺，
  所以按候选键表取，取不到就退化成只画输出 —— 不猜。「工具名不认识」永远有兜底，不丢内容。
- 审批条是终端卡与通用卡**共用**的（`ApprovalBar`），不再每种卡各写一遍。

#### 左栏工作区 = 项目分组（含归档区）

- 每个工作区一行，名字右侧是该工作区名下的**任务数**；默认全部展开，「用户手动折叠过」的才记下来
  （[`sidebar-expansion.ts`](../../../apps/studio/src/views/agent/chat/components/sidebar-expansion.ts)
  落 localStorage，**缺键 = 默认展开**，否则新建的工作区会带着折叠状态出现）。
- 归档工作区单独一段（默认收起）且**不给选中入口**：主进程对归档工作区的读写一律拒绝，做了入口只会换来
  一串报错。它的会话仍挂在它名下 —— 分组时把归档工作区也喂给
  `groupThreadsByWorkspace`，否则那些会话会掉进「未关联工作区」（那个位置是留给真的没有归属的会话的）。
- 恢复走 `workspace:update` 的 `archived: false`；`workspace:archive` 是**单向**的（仅归档）。
  归档 / 恢复后失效的是同一个查询前缀 `['workspace','list']`，主列表与归档区一起刷新。

### 7.8 待办

- BYOK 云供应商：`PROVIDER_PRESETS` 已含 openai / deepseek / qwen / zhipu / ollama / lm-studio /
  openai-compatible，「我的模型」表单可直接添加并选为当前模型；每家还带一份**开箱模型清单**
  （`ProviderPreset.models`：`deepseek-flash` / `deepseek-v4-pro`、`qwen3.8-max` / `qwen3.7-plus`、
  `glm-5.3` / `glm-5.2` …），选中厂商就预填地址与模型名，省掉「去官网抄模型名」这一步。它是**预填而不是白名单**：
  填表外的名字照样发（下拉里可搜索、可回车取用、也可手填），能不能用由上游回答；本机运行时没有公开清单，
  留空由用户填。覆盖规则表驱动（[`provider/preset.ts`](../../../apps/studio/src/features/chat/provider/preset.ts)）：
  文本字段（名称 / 地址 / 默认模型）只有在当前值仍是**出厂值**时才覆盖，用户改过的一律不动；
  「可选用模型」是**数组**、按厂商作用域整体替换预设部分，用户手填的非预设名字保留
  （`mergePresetModelIDs`）—— 否则换厂商会留下上一家的模型名配新厂商的地址，发送必挂。
  表单里两处模型字段都是下拉（单选 / 多选，见
  [`provider/model-field.tsx`](../../../apps/studio/src/features/chat/provider/model-field.tsx)），
  候选清单由 [`provider/models.ts`](../../../apps/studio/src/features/chat/provider/models.ts) 的
  `collectModelOptions()` 合成（厂商预设 → 已声明 → 当前默认）。`anthropic` 仍在
  `UNSUPPORTED_PROVIDER_PRESETS`（opencode 侧要另装 provider 包，不能拿 OpenAI 兼容端点冒充）。
- **能选到 ≠ 服务端有 key**：组织模型只在服务端配好上游供应商与密钥后才会出现在目录里；目录为空时
  选择器与右栏「生效模型」都给出去处提示（`findPlatformBlocker()`），而不是显示一个假默认模型。
- opencode 版本钉定：二进制由 `pnpm sidecar stage studio` 落盘，`.cache/sidecar/` 不随包发出；
  `@opencode/client`（v2，当前 2.0.15）与二进制版本必须同步升级，否则协议面会对不上 ——
  升级时先改 `tools.lock.json` 的 `opencode` pin（url/sha256），再跑
  `pnpm command sidecar opencode`（按 lock 重下，顺带打印 `版本核对通过 <version>`）
  → `pnpm command sidecar stage studio` → `pnpm command sidecar verify studio`。
  **v1 的 `@opencode-ai/sdk` 与「请求体 `tools` 开关」两条路径都已删除，不要再引回来。**
- 审批回执只支持 `once` / `reject`，`always`（记住范围）等有了 UI 再说。
- **自定义 / MCP 工具没进工具表**：它们命中兜底规则，因此按 `mutating` 处理（`ask` 档逐次确认、
  `readonly` 档拒绝、`auto` 档放行），工具卡标题退化成英文原名。要正式支持先在 `shared/agent-tools.ts` 加行：
  给中文标题、给对 `action`（MCP 工具的 action 形状是 `<server>_<tool>`）。
- **opencode 的 cache / reasoning token 没进 studio 用量契约**：`ChatUsage` 只有
  `inputTokens` / `outputTokens` / `totalTokens`，`engine.toUsageFrom` 只映射 `tokens.input/output`，
  所以缓存命中的折扣与思维链 token 都不体现在 UI 上（要么扩契约，要么明确不展示）。
- `patch` 是条件工具（只在模型直出补丁时注册，本机只在部分 GPT 系模型上见到）、`execute` 同理受模型能力限制：
  表里留着它们是为了「名字对上就有中文标题、就能派生规则」，不是承诺一定可见。
- `X-Tenant-ID` 只在 opencode provider 的 headers 上实测透传过，**端到端（网关按租户扣量）尚未走通一次真链路**。
- 服务端目前**只有 `/gateway/quota/me` 校验 `X-Tenant-ID` 的成员身份**（非成员按 `USER` 作用域回答），
  `/chat` 与 `/models` 仍然盲信这个头 —— 有租户 id 的人可以把请求算到别人的租户上（也就花别人的量）。
  这是服务端侧的信任模型问题，本次只记录不改。
- `effect` + `@effect/schema` 版本钉定（P1 前联网核对）。
