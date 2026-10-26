# Plan: Agent 全量能力补全（指令 / 日历 / 知识库 / 自动化）

## TL;DR

三条通道分工，不新造第二条真相：

- **结构化输出通道**（产出型、需评审）：指令草稿、日程计划、知识文档。
- **本地 MCP 通道**（读取/检索 + staging 写入、可多轮调用）：`cogito-mcp`（独立 stdio sidecar）→ app 内 loopback 桥 → Rust service（唯一写者 + store 事件）。
- **既有 IPC 通道**（落库/校验/审批）：`sidecar:saveDirective`、`calendar:write`、`validateDirective`。

明确不做：corex 新增动作；给 agent 一个 `save_directive` 写工具；客户端自建向量库；LangChain/LangGraph。
知识库按 Qoder CN 的 Knowledge Center 形态重构：**Markdown 文件为正文真相 + SQLite 元数据与全文快照 + 本地 FTS5 / 云端 RAG 双通道 + 手动与三路调度 + 可导出**。

## 一、事实校正（本次调研结论）

1. **指令不是"客户端 SQLite"，而是 corex 数据目录下的 `corex.db`**（`apps/client/src-tauri/src/utils/sidecar.rs:23` `COREX_DB_FILE`）。唯一写者是 corex-daemon，客户端经命名管道 `save_directive`（`sidecar_command.rs:328`）。v13 起无 YAML/目录层级真相，YAML 只用于导入导出（`apps/studio/src/shared/ipc/specs/sidecar.ts:13`）。
2. **`保存指令` 工具不需要给 agent**。需要的是一条"把草稿落库"的写路径，而客户端已有（`sidecar:saveDirective` + `validateDirective`）。直接让另一个进程写 `corex.db` 会绕过 daemon 的校验/缓存/运行历史，产生第二个写者。
3. **corex-mcp 本机实测工具面是 7 个**：`corex_actions / corex_action / corex_invoke / corex_run / corex_directives / corex_directive / corex_validate`。**没有** `save_directive`。当前 system prompt 与 `tool-labels.ts` 写的是 daemon RPC 名，二者不一致（指令链路在"写入"这一步会断）。这 7 个名字是**本机当前版本**的实测值，client 打包版本可能不同——必须把名单 pin 进 `agent-tools.lock.json` 并在启动时自检，漂移要告警。
4. **corex 目录本机实测 101 个动作**（data 50 / ui 34 / system 16 / network 1），每个动作有 `params / permissions / risk / input_schema`，但**不预注入** system prompt。注意：**MCP 的 `corex_action` 本身是返回 `risk` 的**，缺的是客户端侧模型（`ActionEntrySchema` 没有 `risk` 字段）。
5. **客户端只注入了 1 个 MCP（corex，stdio）**；goose 支持 http/stdio 扩展且启动参数含 `--enable-scheduler`；但 `_goose/unstable/schedules/*` 只出现在 `.github/prompts` 的二手记录里，**仓库内无调用代码**，必须先 spike、不得直接排期。
6. **服务端 RAG 已有**：compute 三端点（chunks/embeddings/index）+ pgvector 检索；`rag.search` 不开放端点；service 有 `POST /api/v1/rag/index-tasks` 与 `/api/v1/mcp` 的 `cogito_knowledge_search`。**检索无 asset/collection 过滤**、**上传完成不自动索引**、**客户端零 RAG/upload 代码**、**服务端代码内没有 cron/scheduler**（worker 只轮询 outbox）；外部调度只能调 `POST /api/v1/rag/index-tasks`。
7. **日历**：SQLite `calendar` 表 + `calendar:write`（支持 `WriteP::Many` 批量）+ UI 齐全；**agent 无任何日历工具**；`plan` 场景只输出 JSON，无落库代码。
8. **备忘录**：tiptap 编辑器 + 文件系统（全局单根 `rootDir`）+ 文件 watch（外部写入会自动刷新）；无 DB 表、无 agent 工具；导出 HTML/打印已有，无 PDF 文件导出。

## 二、同类实现调研（决策依据）

| 机制                           | 代表                                                    | 优点                                                       | 代价                                           | 本项目适用                                 |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| Function calling               | OpenAI / Anthropic / Gemini                             | 零额外进程、延迟低、审批可控                               | 工具表占上下文；跨产品不可复用；本地能力难隔离 | 产出型（指令/日程/文档）不适合，读取型可用 |
| MCP（tools/resources/prompts） | Claude/Cursor/Qoder、MCP 规范                           | 动态发现（`tools/list`）、变更通知、stdio/HTTP、渐进式发现 | 多一层进程；宿主须兜底审批与权限               | **本地工具面**与**云端检索工具面**         |
| Skills / 插件                  | Qoder Skills、Claude Skills、Cursor Rules               | 面向知识与流程，易分发                                     | 不是动作执行通道                               | 指令/知识生成的可复用模板                  |
| Structured Output              | 各家                                                    | 确定性、可校验、可预览、可测                               | 模型可能产出不合法，需要重试                   | **指令/日程/知识文档**主通道               |
| RAG / Knowledge Base           | Qoder KB、Copilot Spaces、Cursor @Docs、Claude Projects | 语义召回、可引用                                           | 索引与权限复杂                                 | 知识库检索                                 |
| 生成式知识文档                 | Qoder Repo Wiki（Auto Update / Auto Export / Citation） | 结构稳定、可增量、可导出、可供 Agent 引用                  | 生成质量与增量策略                             | 工作区知识库核心形态                       |
| Automations                    | Qoder Automations、Devin、Copilot coding agent          | 定时跑 Agent、留运行记录                                   | 需要调度器与幂等                               | 定时重建/生成                              |

结论：**产出走结构化输出，读取走 MCP，写入走既有 IPC/UI 确认**。这条分工同时满足"不在 corex 加动作"与"不引入第二个控制面"。

## 三、已确认决策

1. 本地工具通道 = **独立 stdio sidecar `cogito-mcp`**（不选应用内 HTTP MCP）。
2. 检索 = **本地 FTS5 + 云端 RAG 双通道**，带融合与去重。
3. 调度 = **A 客户端 worker + B goose schedules + C 服务端 scheduler** 三路并存，用 `owner` 互斥。
4. 备忘录 → **Knowledge 破坏性重构**：**markdown 磁贴在全仓统一改名为 knowledge**（client / studio / extension / mobile / shared 类型），tile / 路由 / 偏好 / 目录语义全部改名，不兼容旧数据；正文仍以 Markdown 文件为准，元数据与全文快照落 SQLite。

## 四、目标架构

### 4.1 工具面三层

**命名规则**：本地工具统一 `app_` 前缀（与 `cogito_knowledge_search`、goose 内置 `search` 区分，标签映射稳定）。

- **本地工具（`cogito-mcp`，stdio，ACP 注入）**
  - `app_calendar_read`（读区间）
  - `app_knowledge_list_bases / app_knowledge_list_docs / app_knowledge_read_doc / app_knowledge_search`
    - **检索只暴露这一条**：内部融合本地 FTS 与云端 RAG，避免模型同时看到两个 `knowledge_search` 而重复调用。
  - `app_knowledge_write_doc`：**只写 `<root>/.staging/<session>/`**，需审批；发布（移到正式目录 + 入库）永远是 UI 动作。
  - `app_workspace_list / app_workspace_read`：受 `agent_workspace_folder` 白名单约束；路径先 canonicalize 再校验前缀，拒绝 symlink 越界。
- **云端工具（session extension，streamable HTTP）**
  - `${cogito}/api/v1/mcp`（headers：Bearer + `X-Tenant-ID`）。**默认不注册给模型**：本地 `app_knowledge_search` 已含云端通道；仅在本地网关被关闭时作为降级入口。
- **写工具规则（消除"不暴露写工具"与 `knowledge_write_doc` 的矛盾）**

| 产物     | 通道                               | 理由                                        |
| -------- | ---------------------------------- | ------------------------------------------- |
| 指令     | 结构化输出，无写工具               | 单份小 JSON；写入者必须是 corex-daemon      |
| 日程     | 结构化输出，无写工具               | 小；必须人工确认                            |
| 知识文档 | **只允许 staging 写工具**          | 长文档无法一次输出；发布仍由用户确认        |

### 4.2 `cogito-mcp` 与控制回路

- 新 workspace crate `apps/client/src-tauri/crates/mcp`，`[[bin]] cogito-mcp`，用 `rmcp`（corex 已用 3.4）+ stdio transport。
- sidecar **不直接开 `cogito-client.db`**：它把 `tools/call` 代理到 app 内 loopback 桥：
  - app 启动时绑 `127.0.0.1:0` + 随机 token，暴露 `GET /internal/tools/list`、`POST /internal/tools/call`。
  - 工具实现放 `crates/core/src/tools/**`（Rust），复用 `calendar::Service`、`knowledge::Service`、`state.connection()`。
  - 好处：单写者、store 事件照常广播、审批仍由 app 控制。
- ACP 注入：`findCorexMcpServers` 同款，新增 `findCogitoMcpServers`，env：`COGITO_BRIDGE_URL / COGITO_BRIDGE_TOKEN / COGITO_SESSION_ID / COGITO_WORKSPACE_ID`。
- 路径解析：照 `find_corex_mcp_path` 的顺序（`current_exe` 同目录 → 向上找 `binaries/` → PATH）；注意 dev 下进程在 `target/debug`、二进制在 `src-tauri/binaries/`，解析要覆盖这条。
- 桥边界：只绑 `127.0.0.1`、禁 CORS、校验 `Host/Origin`；token 每次启动轮换；sidecar **调用前探活**，桥重启后重连失败要返回结构化错误而不是挂死。
- 打包：`tauri.conf.json` externalBin、`build.rs` 必需文件、`scripts/.../targets/client.ts`、CI 占位文件（`for stem in corex-daemon corex-mcp cogito-mcp goose`）同步；`cogito-mcp` 由本仓 cargo 构建并 stage（corex-mcp 仍是下载），`pnpm dev:client` / `pnpm build` 前必须先 stage。
- 权限：**不需要**改 `capabilities/default.json` 的 `shell:allow-spawn`（进程由 goose 拉起，不经 app shell）；只有 app 自己 spawn 做健康检查时才需要补一条。

### 4.3 知识库（Knowledge）

**语义**：一个 Knowledge Base = 一个可检索的知识域（用户级或工作区级），含若干文档；文档正文是 Markdown 文件，SQLite 存元数据 + 全文快照 + 索引状态。

**新表（客户端，全部并入 v001；含知识库、自动化与指令草稿）**

| 表                      | 关键列                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge_base`        | `id / title / slug / description / scope(user\|workspace) / workspaceID / rootPath / settingsJSON(autoUpdate,autoExport,citation,cloudIndex) / archivedAt / lastIndexedAt / createdAt / updatedAt`                                                            |
| `knowledge_doc`         | `id / baseID / title / path / hash(sha256) / bytes / revision / kind(generated\|imported\|authored) / sourceSessionID / status(draft\|ready\|stale\|indexing\|indexed\|failed) / error / body(全文快照) / createdAt / updatedAt`                         |
| `knowledge_doc_fts`     | FTS5 外部内容表（`content='knowledge_doc'`, `content_rowid='rowid'`，避免第三份正文），列由 `knowledge_doc` 提供；查询 <3 字符走 `LIKE` 回退                                                                                                                                     |
| `knowledge_index_state` | `docID PK / tenantID / localRevision / localIndexedAt / assetID / assetHash / cloudModel / cloudDimensions / cloudRevision / cloudStatus / cloudError / cloudIndexedAt`                                                                                    |
| `automation`            | `id / kind / owner(client\|goose\|cloud) / targetID / cron / timezone / enabled / nextRunAt / lastRunAt / lastStatus / lastError / runAsUserID / settingsJSON`                                                                                              |
| `automation_run`        | `id / automationID / trigger(schedule\|manual\|catchup) / status / startedAt / finishedAt / summary / error`                                                                                                                                             |
| `directive_draft`       | `id / title / contentJSON / sourceSessionID / status(pending\|opened\|discarded) / createdAt / updatedAt`（指令草稿收件箱）                                                                                                                            |

**不变量**：

- 写文档只经 `knowledge::Service`（写文件 + 更新 DB 快照 + 重建该行 FTS）；其它路径一律视为缺陷。
- **双写冲突规则**：自身写入 → 更新 `hash` 并**抑制本次 watch**；外部写入 → `hash` 不同才回灌；回灌时编辑器有脏数据 → 弹「保留 / 重载」（复用 `workspace/external-dialog.tsx`）。
- **体积**：单文档 2 MB 上限（导入/生成时拒绝并提示）；FTS 用外部内容表，不存第三份正文；列表分页、正文懒加载。
- **删除/归档**：删 base 或 doc 时同批删除文件、FTS 行、`knowledge_index_state`；云端 asset 默认保留（可手动清理），避免误删共享资产。

**生成（Qoder Repo Wiki 式）**：大纲 → 分章 → 合并；选项 `autoUpdate / autoExport / citation`；产物先写 `<root>/.staging/<run>/`（只能由 `app_knowledge_write_doc` 写），成功后原子提交并入库；`kind=generated` + `sourceSessionID`。生成期间向前端发进度事件（大纲/第 n 章/合并），失败只清 staging，不动已有文档。

**检索双通道**：本地 FTS5（BM25） + 云端 pgvector；在 app 侧做 RRF 融合、按 docID 去重、topK 截断。

- **短查询**：FTS5 `trigram` 要求 ≥3 字符，1–2 字中文（如「日程」）永远命中不到——必须回退 `LIKE '%q%'`（限条数与字数）。
- **融合键**：本地命中是 `docID`，云端命中是 `assetID + ordinal`；靠 `knowledge_index_state.assetID` 映射回 `docID` 后再去重。
- **云端过滤**：必须同时带 `tenantID + model + dimensions`（`search_find` 就按这三项过滤），否则召回为空。
- **降级**：云端不可用/无权限 → 只用本通道，并在工具结果里标明 `cloud: unavailable`。

### 4.4 调度三路

| owner    | 机制                                                                                         | 适用                               | 保障                                             |
| -------- | -------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| `client` | `src-tauri/src/automation/worker.rs`（照 `reminder/worker.rs`：12s 轮询 + claim + catch-up） | 本机知识库重建/生成                | 应用运行即生效；启动补跑；`nextRunAt` 事务内推进 |
| `goose`  | `_goose/unstable/schedules/*`（先 spike）                                                    | Agent 定时任务（跑 prompt/recipe） | 依赖 goose 语义验证；失败回退 `client`           |
| `cloud`  | 服务端 `scheduled_job` + worker 轮询（`FOR UPDATE SKIP LOCKED`）                             | 云端已同步文档的重建               | 关客户端也能跑；需新增表与接口                   |

**互斥**：一个 automation 只有一个 `owner`；每次执行用 `(automationID, scheduledFor)` 幂等键；`automation_run` 留全量记录。

**三路必须回答的细节（原计划缺失）**：

- **云端身份**：`owner=cloud` 的任务到点要过 `Auth` + 权限校验，必须以 `runAsUserID` 代跑（并校验其仍是租户成员）或限定为租户级服务账号；这条不定，Phase 7C 不成立。
- **时区/DST**：cron 按 automation 自己的 `timezone` 解释，`nextRunAt` 存 epoch；夏令时跳变时以「下一次合法本地时间」为准。
- **漏跑**：应用/服务重启后**只补一次**（coalesce），不补齐所有错过的时间点；`trigger=catchup` 可区分。
- **长任务**：重建/生成是分钟级，worker **不阻塞 tick**：claim 后 spawn，状态写 `automation_run`，下一次 tick 只处理到期行。
- **goose 镜像**：`owner=goose` 的行由客户端 UI 创建 → 调 ACP `schedules/*` → 回写 goose 侧 id；本地行只读 `nextRunAt`，不参与本地 claim；API 不可用时 owner=goose 直接禁用。

### 4.5 指令生成（不新增写工具）

- 入口：指令库「AI 生成」+ 编辑器「AI 修改」+ 对话快捷卡。
- 上下文：最近 N 条会话消息摘要、工作区文件树（深度 3、仅文件名、忽略规则与条数上限）、corex 目录摘要，以及**从现有指令里取 1–2 个作为 few-shot**（`corex_directives` → `corex_directive`）。
- 输出：`DirectiveContent` 结构化草稿（复用 `shared/ipc/specs/sidecar.ts` 的 zod schema）；解析失败先本地 repair，再进下一轮。
- 客户端：校验 → 打开编辑器 → `corex_validate` → 错误作为下一轮 user 消息回灌（≤3 轮）→ 用户保存。
- **草稿收件箱**：chat 里生成但未打开的草稿不能只放内存——落 `directive_draft` 表（或至少持久化 Store），重启后在指令库显示「待确认草稿」。
- 工具名对齐：prompt 与 `tool-labels.ts` 改用 `corex_*` 实际名；启动时 `tools/list` 自检并打日志；自检失败就禁用 corex 工具并提示，而不是让模型瞎猜。
- corex 能力注入：按 bucket 概览 + 计数（渐进式发现），动作详情让模型调 `corex_actions`；token 预算建议 ≤ 8k 字符，超出按 bucket 轮转截断。

### 4.6 日历

- `plan` 场景输出 `SchedulePlan` 结构化 JSON（title/notes/startISO/endISO/entireDay/color）。**必须先往 prompt 注入当前时间、时区与「明天/下周」的解析基准**，否则相对时间无法落库。
- 解析方式：沿用「从助手文本里取围栏 JSON」（端口没有原生 structured output），schema 校验 + repair；不接受模型自带的时区偏移，统一转本地。
- 预览卡片可编辑 → 确认后 **批量** `calendar:write`（`WriteP::Many` 已支持）；批量失败整体回滚，成功后刷新 `stores/calendar`。
- `app_calendar_read` 只读工具支持对话式修订；写仍走预览确认。
- 全天语义：`entireDay=true` 时 `startAt = 本地 00:00`、`endAt = 次日 00:00 - 1ms`（对齐 `calendar-view.tsx` 的 `bounds.to - 1`）。
- 提醒：默认**不建** reminder；预览页提供「开始时提醒」勾选（写 `reminderID`），避免静默产生通知。
- 冲突：同标题 + 时间重叠给出提示（不阻断）；支持一次撤销整批导入。

## 五、实施阶段

### Phase 0 — 地基校正（依赖：无）

1. 启动时 `tools/list` 自检 corex 工具（cogito 在 Phase 2 加入），对照 `agent-tools.lock.json` 打日志/告警。
2. `prompts.ts` 重写：去掉 `save_directive` 等不存在的名字，按实际工具名与"渐进式发现"组织。
3. `tool-labels.ts` 补齐 `corex_*` 名称。
4. `approval.ts` 的 `WRITE_TOOL_NEEDLES` 改为 `TOOL_EFFECTS` 表（create/append/update/save/put/delete/index 都算写）。
5. 新增 `features/agent/model/capabilities.ts`：corex 目录 → 紧凑能力地图（bucket 概览 + 必填参数 + 权限/风险），带 token 预算与缓存。

文件：`features/agent/acp/session.ts`、`features/agent/model/{prompts,tool-labels,approval,capabilities}.ts`、`stores/corex.ts`（目录缓存）。
验证：单测（prompt 内容、标签、效果分类）+ 实机检查日志里的工具名。

### Phase 1 — 指令一键生成（依赖 Phase 0）

1. 新增 `features/agent/directive-draft.ts`：结构化输出解析 + 校验 + 错误回灌。
2. 入口：`views/directive/library/library.tsx`（AI 生成）、`views/directive/orchestrator/toolbar.tsx`（AI 修改）。
3. 上下文组装：新增 `features/agent/context/`（会话摘要、工作区树、corex 概览、现有指令 few-shot）。
4. 草稿收件箱：落 `directive_draft` 表（并入 v001；重启不丢），指令库显示「待确认草稿」；打开时复用 `stores/corex.ts` 的 `openEditor/replaceDraft`。
5. 保存/校验：`saveDirectiveToHost` + `validateDraft`（客户端走 daemon IPC；agent 自查可用 `corex_validate`），错误回灌（≤3 轮）。
   文件：`views/directive/**`、`stores/corex.ts`、`features/agent/model/prompts.ts`。
   验证：单测 schema/解析；实机：从"工作区 + 一句话"生成 → 校验通过 → 打开编辑器。

### Phase S — 前置 spike（0.5 天 × 3，先于 Phase 2）

1. **打包 spike**：本地构建 `cogito-mcp` → stage 到 `src-tauri/binaries/` → `tauri dev` 中 `tools/list` 能看到它。不通则 Phase 2 不能开工。
2. **工具名/协议 spike**：用 client 打包的 corex-mcp 实跑 `tools/list`，确认 7 个名字、`risk` 字段与 goose 的 server 前缀规则；据此定 Phase 0 的 prompt 与 `agent-tools.lock.json`。
3. **goose schedules spike**：`_goose/unstable/schedules/*` 能否建 cron + 跑 prompt；结论决定 Phase 7B 去留。
4. **门槛**：任一不通过都不继续对应 Phase——打包不通 → Phase 2/3 停；工具名不一致 → Phase 0 先改 prompt 并禁用工具；schedules 不通 → Phase 7 只保留 A/C。

### Phase 2 — `cogito-mcp` 与本地工具（依赖 Phase 0 + Phase S，可与 1 并行）

1. 新 crate `crates/mcp`（rmcp stdio）+ workspace 成员 + `[[bin]]`。
2. app 内 loopback 桥：`src-tauri/src/bridge/{mod,http}.rs`（axum，随机端口 + token），启动于 `app/bootstrap.rs`。
3. 工具注册表 `crates/core/src/tools/{mod,calendar,workspace}.rs`，统一 `ToolSpec{name, description, schema, effect}`（`knowledge` 模块在 Phase 5 加）。
4. 注入：`findCogitoMcpServers`（`acp/session.ts`）。
5. 打包链：`tauri.conf.json` externalBin、`build.rs` 必检、`scripts/.../targets/client.ts`、CI 占位（加 `cogito-mcp`）、`sidecar bootstrap` 的本地构建分支；`dev/build` 前置 stage。**不改 `capabilities/default.json`**（goose 拉起，不经 app shell）。
6. 只读工具先行：`app_calendar_read`、`app_workspace_list`（`app_knowledge_*` 依赖 Phase 4 的表，放 Phase 5）。
   文件：`Cargo.toml(workspace+app)`、`crates/mcp/**`、`src-tauri/src/{bridge,app}/*`、`tauri.conf.json`、`build.rs`、`scripts/commands/features/sidecar/**`、`.github/workflows/continuous-integration.yaml`。
   验证：`cargo test -p thinking-core -p thinking-mcp`；实机 `tools/list` 出现 `app_*`；`app_calendar_read` 返回真实数据；删掉二进制后构建要给可读错误。

### Phase 3 — 日历一键生成（依赖 Phase 1 的解析范式、Phase 2 的 `app_calendar_read`）

1. `features/agent/schedule-plan.ts`（zod schema + 解析/容错）。
2. 预览组件 `views/agent/chat/components/plan-schedule-card.tsx`（可编辑行、冲突提示、"开始时提醒"勾选）。
3. 批量落库：`stores/calendar.ts` 增加批量写；`calendar:write` 传数组；失败整体回滚，成功后刷新 store。
4. `prompts.ts` 的 plan 场景改为输出结构化 JSON（不再只写"单个 JSON 代码块"），并注入**当前时间 + 时区 + 相对日期基准**。
5. 全天语义与冲突：`entireDay` → `endAt = 次日 00:00 - 1ms`；同标题+重叠只提示不阻断。
6. 撤销：记住本次批量写入的 id，提供一次性撤销。
   验证：fixture 解析；实机"明天的工作与休息日程" → 预览 → 改一行 → 写入 → 日历可见 → 撤销。

### Phase 4 — Knowledge 破坏性重构 + 磁贴统一改名（依赖无，建议紧跟 2）

1. **全仓统一改名**（只改 tile/component id 与界面文案，`markdown` → `knowledge`）：
   - `packages/shared/src/types/magnetic-tile.d.ts`：union 直接改成 `knowledge`，不保留 `markdown`。
   - client：`constants/magnetic-tile/{components,window}.ts`、`features/magnetic-tiles/markdown/**` → `knowledge/**`、`features/controller/reflection.tsx`、`views/overlay/markers.tsx`（`markdown: bindMarker(...)`）、`features/magnetic-tile/session.ts`（脏文档保护）、`features/command-bar/{types,constants,providers/markdown}.ts`、`views/markdown/**` → `views/knowledge/**`、`views/knowledge/caption/begin.tsx`（`findComponentLabel`）、路由/i18n/磁贴提示/偏好键。
   - studio：`constants/magnetic-tile/components.ts`、`shared/ipc/specs/mirror.ts`、`drizzle/migrations/0000_init.sql` 的磁贴种子。
   - extension：`components/magnetic-tiles/markdown/**` → `knowledge/**`，重新生成 `types/components.d.ts`。
   - mobile：`types/magnetic-tile.ts`、`services/tileSeed.ts`（`tile-markdown` → `tile-knowledge`）、`components/tiles/{MarkdownTile,MagneticTileView}.tsx`、`tileSeed.test.ts`。
   - service（若确认 `application::Component` 属于同一枚举）：`schema.rs` 的 `Markdown` → `Knowledge`，`pnpm contracts` 重新生成 `packages/types/src/openapi.d.ts`；这是对外 API 的破坏性变更，需检查镜像调用方。
   - **不改**：Markdown 文本格式与渲染器（`markdown-text.tsx`、`MarkdownBubble`）、tiptap 的 `language: 'markdown'`、文件扩展名与导出格式。
2. **迁移合并（不新增迁移文件）**：把 `migrations_v002..v005` 的内容按序并入 `migrations_v001.rs`（即你说的 v0001），删除 v002–v005；`migrations/mod.rs` 与 `migration.rs` 的 `migrations()` 只保留 v001。
3. 在 **v001 内**新增 `knowledge_base / knowledge_doc / knowledge_doc_fts / knowledge_index_state / automation / automation_run / directive_draft`；FTS5 虚表用 `execute_unprepared` 原生 SQL（SeaQuery 建不了），并配 `knowledge_doc` 的同步触发器或 service 内显式重建。
4. v001 的 `magneticTile` 种子行直接改为 `component='knowledge'`、标题「知识库」、描述同步（fresh 后无需 `UPDATE`）。
5. **执行 fresh**：`pnpm --filter @cogito/client migrate:fresh`（脚本会先备份 `cogito-client.db`）；studio 的 `0000_init.sql` 只对新库生效，本地 dev 需删 studio 库重建。
6. 目录与写入不变量：每个 base 一个目录（`<root>/<slug>/`），`assets/` 同目录；不再全局单根；旧 `rootDir` 不再读取。`knowledge::Service` 统一写文件 + DB 快照 + FTS 重建；自身写入抑制 watch，外部修改按 hash 回灌，脏编辑器走「保留 / 重载」。
7. **tiptap AI 交互**：编辑器工具栏加「AI 续写 / 重写选区 / 总结」，走同一 `app_knowledge_*` 通道；结果先进 diff 预览再应用，保留 undo。
8. UI：知识库列表（grid/list）、文档列表、编辑器（复用 tiptap）、新建/导入/导出。
   验证：`cargo test -p thinking-database`（空库全量迁移 + 种子 `component='knowledge'` 断言 + 只有 v001）；`migrate:fresh` 后实机新建/编辑/外部改文件/搜索/选区 AI；extension/mobile/studio 单测通过。

### Phase 5 — 本地检索与知识生成（依赖 Phase 2 + Phase 4）

1. FTS5 `trigram` 检索 + BM25；**<3 字符走 `LIKE` 回退**；查询清洗（去标点/限制长度）。
2. 注册 `app_knowledge_list_bases / app_knowledge_list_docs / app_knowledge_read_doc / app_knowledge_search`（此时表已就绪）。
3. 生成编排：大纲 → 分章 → 合并；`app_knowledge_write_doc` 只写 staging（审批 + 路径限定）；成功后原子提交；`autoUpdate / autoExport / citation` 选项；进度事件。
4. 提示词与上下文：工作区树、已有文档去重（title+hash）、引用格式（`[doc:title#ordinal]`）。
5. 发布：UI 预览 staging 产物 → 确认后入库 + 写正式文件；冲突（同名/同 slug）按「替换 / 保留两者」选择。
   验证：中文 1–2 字/英文/混合查询召回；生成一篇文档 → 发布 → 检索命中；导出 md/html；staging 越界写入被拒。

### Phase 6 — 云端 RAG 通道（依赖 Phase 5；跨仓/跨服务）

1. compute：`search_find` 增加 `assetIDs` 过滤（SQL `AND i.asset_id = ANY($x)`）；**沿用现有 `tenant_id + model + dimensions` 过滤**；补单测。
2. service：新增 `POST /api/v1/rag/search {query, topK, assetIDs?}`（Auth + tenant + `Asset:Read`）；MCP 工具增加 `collection/assetIDs`。
3. 客户端：`apis/upload.ts`（prepare/hash/chunk/finalize）+ `apis/rag.ts`（index-tasks 创建/轮询）+ 文档 → asset 映射。
4. **模型/维度**：端上固定 embed 模型，`knowledge_index_state` 写 `cloudModel / cloudDimensions`；两者不一致时直接不参与云端召回。
5. **资产生命周期**：以文档 `hash` 做上传去重；重新索引时“新 asset 替换旧 asset”并回写 `assetID/assetHash`，避免旧版本被召回到。
6. **租户**：索引状态带 `tenantID`；切换租户时旧映射作废，不参与融合。
7. **权限与成本**：无 `Asset:Write/Read` 时降级为本地通道并在 UI 提示；上传/嵌入消耗配额，发布前提示，沿用 `findSendBlocker` 口径。
8. 融合：app 侧 RRF + 去重（`assetID → docID`）；`knowledge_index_state` 记录进度/错误；跨端链路带 traceparent。
9. session extension：把 `${cogito}/api/v1/mcp` 加为 streamable HTTP（仅作降级入口；headers 走最新 JWT/tenant，401 时刷新）。
   验证：单篇文档上传 → 索引 SUCCEEDED → 双通道融合（去重后 topK 合理）；无权限时只用本通道。

### Phase 7 — 自动化（依赖 Phase 5/6）

1. `automation` / `automation_run` 表 + `knowledge` UI 的"自动化"页签（Qoder Automations 形态）。
2. **A** 客户端 worker（照 `reminder/worker.rs`）+ cron 计算（`cron`/`croner` crate，按 automation 时区）+ 启动补跑（只补一次）。
3. **B** 仅当 Phase S-3 spike 通过：接 `_goose/unstable/schedules/*`；本地行只做镜像，不参与 claim；不通过则 owner=goose 禁用并写入文档。
4. **C** 服务端 `scheduled_job` + worker 轮询 + `POST/GET /api/v1/automations`（多副本用 `SKIP LOCKED`）；**先定身份**：`runAsUserID` 代跑（校验租户成员）或租户服务账号。
5. 执行模型：claim 后异步 spawn，写 `automation_run`；长任务不阻塞 tick；失败重试上限 + 退避。
6. 互斥与幂等：`owner`、`nextRunAt` 事务推进、`(automationID, scheduledFor)` 唯一。
   验证：手动/定时各一次；重启只补跑一次；重复 tick 与多副本不重复执行；关客户端后云端任务仍执行（C）。

### Phase 8 — 导出与收尾

- 知识库整包导出（zip of md）与单篇 md/html/打印 PDF（复用现有导出实现，随 Phase 4 迁到 `views/knowledge/lib/export.ts`）。
- 删除/归档链路：base/doc → 文件 + FTS + index state 同批删除；云端 asset 默认保留并给手动清理入口；旧 `markdown-backups/` 提示清理。
- 旧数据：**fresh 会清空本地业务库**（脚本先备份）；不自动迁移，设置页提供一次性「导入旧 Markdown 目录」向导（可选）。
- 删除旧 `views/markdown` 残留与旧偏好键；更新 `docs/apps/client/**`（新增 knowledge、agent 工具面文档）。
- 可观测：生成耗时、索引状态、检索命中率、失败原因；跨端带 traceparent，异常走 `reportCaught`。

## 六、关键文件清单

- 工具面：`apps/client/src/features/agent/acp/session.ts`、`features/agent/model/{prompts,tool-labels,approval,capabilities}.ts`、`features/agent/port/model.ts`
- sidecar：`apps/client/src-tauri/{Cargo.toml,tauri.conf.json,build.rs}`、`crates/mcp/**`、`src-tauri/src/bridge/**`、`src-tauri/src/automation/worker.rs`
- 数据层：`crates/database/src/migrations/migrations_v001.rs`（**唯一迁移文件**）、`migrations/{mod.rs}`、`migration.rs`、`crates/database/src/{entity,lib.rs}`、`crates/core/src/{knowledge,calendar,agent_workspace,tools}/**`、`crates/command/src/**`、`src/app/handlers.rs`、`src/shared/ipc/channels.ts`
- 前端：`stores/{knowledge,calendar,corex}.ts`、`views/knowledge/**`、`views/directive/**`、`views/agent/chat/components/**`
- 改名引用（全仓）：client `features/magnetic-tiles/markdown/**`、`features/controller/reflection.tsx`、`views/overlay/markers.tsx`、`constants/magnetic-tile/{components,window}.ts`、`features/command-bar/**`、`features/magnetic-tile/session.ts`；`packages/shared/src/types/magnetic-tile.d.ts`；studio `constants/magnetic-tile/components.ts` + `drizzle/migrations/0000_init.sql` + `shared/ipc/specs/mirror.ts`；extension `components/magnetic-tiles/markdown/**` + `types/components.d.ts`；mobile `types/magnetic-tile.ts` + `services/tileSeed.ts` + `components/tiles/**`；service `services/application/schema.rs` + `packages/types/src/openapi.d.ts`（重新生成）
- 服务端：`apps/compute/src/compute/rag_ingest/search.py`、`apps/service/src/services/rag/**`、`apps/service/crates/mcp/**`、`apps/service/src/{worker,bin}/*`
- 打包/CI：`scripts/commands/features/sidecar/targets/client.ts`、`.github/workflows/continuous-integration.yaml`

## 七、验证

1. **Phase S**：三个 spike 各自出结论文档；打包不通不得进 Phase 2。
2. Phase 0/1：`pnpm --filter @cogito/client exec vitest run src/features/agent` + 实机指令生成闭环 + `agent-tools.lock.json` 漂移告警单测。
3. Phase 2：`cargo test -p thinking-core -p thinking-mcp`；实机 `tools/list` 出现 `app_*`；`app_calendar_read` 真实数据；**删二进制后构建给可读错误**。
4. Phase 3：fixture 解析（含时区/DST/全天）+ 日历批量写入/回滚/撤销实机。
5. Phase 4：`cargo test -p thinking-database`（空库全量迁移 + **只有 v001** + 种子 `component='knowledge'`）；`pnpm --filter @cogito/client migrate:fresh`；**FTS5 原生 SQL**；外部改文件回灌与脏编辑器冲突；client/studio/extension/mobile 改名后的单测与类型检查。
6. Phase 5：中文 1–2 字/英文/混合查询召回；staging 越界写入被拒；生成→发布→检索命中。
7. Phase 6：compute/service 单测；上传→索引 SUCCEEDED；**模型/维度不一致时云端不参与**；跨租户不污染；无权限降级。
8. Phase 7：三路各一次；重启只补一次；重复 tick/多副本不重复；长任务不阻塞 tick。
9. 全量：`pnpm lint`、`pnpm unit`、`cargo test`（client workspace）、`apps/compute` pytest、`apps/service` cargo test。

## 八、风险与待验证

1. **corex 工具名/风险信息可能随版本漂移**：以 client 打包版本的自检为准，`agent-tools.lock.json` pin 名单；不一致就禁用工具并提示，不让模型猜。
2. **`cogito-mcp` 打包链**：externalBin + build.rs + CI 占位 + dev 前置 stage 缺一不可；否则 `pnpm build` 直接 panic。
3. **FTS5 trigram 对 1–2 字中文会查不到**（确定发生）：必须带 `LIKE` 回退；仍不达标再换 jieba-rs + 倒排。
4. **云端检索过滤是跨服务改造**（compute/service），必须与双通道同批上线，否则库之间无法隔离；还要固定 embed 模型/维度。
5. **服务端调度身份未定**：`runAsUserID` 代跑 vs 租户服务账号，必须先选一条，否则 Phase 7C 不成立。
6. **token 过期**：HTTP extension 需 401 刷新；本地桥需探活重连（桥重启后 URL 失效）。
7. **破坏性重构**：全仓 tile id 改成 `knowledge`；迁移合并到 v001 后必须 fresh（删库不可逆，`migrate.ts` 会先备份）；studio 种子只对新库生效；service 枚举变更要重新生成 contracts。
8. **双写不变量**：正文以文件为准、DB 存快照；所有写入必须经 `knowledge::Service`；watch 冲突按「自身抑制 / 外部回灌 / 脏则询问」。
9. **同一能力只保留一个工具入口**：本地 `app_knowledge_search` 含云端通道；云端 MCP 仅作降级；否则模型会双调。
10. **改名边界**：只改 tile/component id 与文案；Markdown 文本格式、渲染器、文件扩展名、导出格式不动，避免无谓 churn 与行为变化。

## 九、范围外

- 不新增 corex 动作、不引入 LangChain/LangGraph。
- 不做多端实时协同（Yjs/Hocuspocus）与 OCR/多格式解析（后续可走窄库通道）。
- 不把日历改为可重复日程（recurrence）；先在自动化里表达"每周重建"。
- **改名边界**：全仓统一改 tile/component id；Markdown 文本格式、渲染器、文件扩展名、导出格式保持原样。

## 十、执行记录（本次会话）

### 已完成

**Phase S（spike，已实测，非纸面结论）**
- 用 client 打包的 `corex-mcp-x86_64-pc-windows-msvc.exe` 实跑 MCP stdio：`initialize` → `serverInfo` = `corex-mcp 14.0.0`，`tools/list` = **7 个工具**，与 `agent-tools.lock.json` 完全一致。
- 实测入参：`corex_actions{bucket,ids,limit}`、`corex_action{id}`、`corex_directives{names,limit}`、`corex_directive{name}`、`corex_validate{definition,strict}`、`corex_invoke{id,params}`、`corex_run{name|path,input}`（oneOf）。
- **重要修正**：工具上**没有 `risk` 字段**，只有 MCP `annotations`（`readOnlyHint` / `destructiveHint` / `openWorldHint`）；动作级风险在 `corex_actions` 的**返回值**里，形状是对象 `{is_read_only,is_destructive,is_open_world}`（不是字符串/数字）。
  - 已据此改 `capabilities.ts` 的 `formatRisk`（支持对象→「只读/破坏性/开放世界」）。
- 未做：S-1（`cogito-mcp` 打包 spike）、S-3（goose schedules spike）—— 需要先产出 `crates/mcp`，见「待办」。

**Phase 0（地基校正，已完成）**
- `features/agent/agent-tools.lock.json`：pin corex 7 个工具 + 本地 8 个 `app_*`。
- `features/agent/agent-tools.ts`：`verifyAgentTools`（词边界匹配，避免 `corex_action` 误命中 `corex_actions`）。
- `features/agent/model/capabilities.ts`：动作目录 → 紧凑能力地图（bucket 分组、必填参数、权限、风险对象），带字符预算与截断提示。
- `features/agent/model/prompt-context.ts`：注入能力地图 + 本地时间/时区（plan 场景）。
- `features/agent/model/prompts.ts`：改成真实 `corex_*` 工具名与入参签名；明确「不落库」「不要调用 save_directive」；step 必须带 `id`+`action`（对齐 `DirectiveContentSchema`）。
- `features/agent/tool-labels.ts`：补 `corex_*`（复数在前）与 `app_*` 标签，保留旧 RPC 名兼容。
- `features/agent/approval.ts`：`WRITE_TOOL_NEEDLES` → 读/写有序分类 + `app_*` 未知失败关闭。
- `features/agent/acp/session.ts`：建会话后 `tools/list` 自检一次（只告警，不阻塞）。
- 单测：`prompts/capabilities/agent-tools/approval` 共 8 文件 53 测试通过。

**Phase 4（数据库部分 + 全仓改名，已完成）**
- 迁移合并：`migrations_v001.rs` 吸收 v002–v005（album / bookmark / signboard_entry_asset / `progress`+`role` 列），删除 v002–v005，`mod.rs` 与 `migration.rs` 只注册 v001。
- v001 内新增：`knowledge_base`、`knowledge_doc`、`knowledge_doc_fts`（FTS5 external content + 三个同步触发器）、`knowledge_index_state`、`automation`、`automation_run`、`directive_draft`。
- 种子行改 `component='knowledge'`、标题/描述「知识库」。
- `cargo test -p thinking-database` 5 个测试通过（含「只有 v001」「种子为 knowledge」「FTS 插入/删除触发器」「v002–v005 对象存在」）。
- `pnpm --filter @cogito/client migrate:fresh` 已执行成功。
- 全仓改名 `markdown` → `knowledge`（tile/组件 id、路由、偏好键、命令 id、命令面板域）：
  - client：`features/magnetic-tiles/knowledge/**`、`views/knowledge/**`、`stores/knowledge.ts`、`keyboard/definitions/knowledge.ts`（`KNOWLEDGE_*`）、`@/views/knowledge/*` 别名、`tiles.knowledge` 偏好键、`findKnowledgeTilePrefs`、路由 `/knowledge`、命令面板 `knowledge` 域与 `knowledgeProvider`。
  - shared：`MagneticTile.Component` 联合类型；studio：组件白名单、`mirror.ts`、drizzle 种子；mobile：类型、`tileSeed`、`KnowledgeTile.tsx`；service：`application::Component::Knowledge` + `packages/types/src/openapi.d.ts`。
- client 全量单测 61 文件 350 测试通过；studio/mobile 的 `tsc` 复核时只剩既有环境问题（`@cogito/hooks` 未构建、mobile tsconfig `baseUrl` 与当前 TS 版本冲突）。

**Phase 1（指令一键生成，已完成「生成 → 草稿 → 打开编辑器」闭环）**
- Rust：`entity/directive_draft.rs`、`core/src/directive_draft/{service,mod}.rs`（save/list/setStatus/remove）、`command/src/directive_draft.rs`（`directiveDraft:save|list|setStatus|remove`）、`handlers.rs` 注册。
- client：`shared/ipc/specs/directive-draft.ts`、`lib/directive-draft-ipc.ts`、`stores/directive-draft.ts`、`features/agent/directive-draft.ts`（围栏/裸 JSON 解析、`definition` 解包、zod 形状校验、`validateDirective` 严格校验、`captureDirectiveDraft`、`openDraftInEditor`）。
- 触发：`port/model.ts` 在 directive 场景收尾时自动解析并落草稿 + toast；指令库新增「待确认草稿」收件箱（打开/丢弃）与「AI 生成」入口（`pending-prompt` 单槽 → 聊天欢迎页灌入场景与提示词）。

**Phase 3（日历一键生成，已完成「生成 → 预览 → 批量写 → 撤销」）**
- `features/agent/schedule-plan.ts`：`{"events":[...]}` 解析、ISO→epoch、全天语义（`endAt = 次日 00:00 - 1ms`）、非法行丢弃、重叠提示（只提示不阻断）、`toWrites`。
- `stores/schedule-draft.ts` + `views/agent/chat/components/plan-schedule-card.tsx`（可改标题/时间、逐行删除、冲突提示、写入后一次性撤销）；挂在 chat 主区底部。
- `stores/calendar.ts` 新增 `toWriteEvents`（数组 → `WriteP::Many`，后端同事务）与 `toRemoveEvents`。
- plan 提示词改为精确 JSON 形状（带本地偏移的 ISO、`entireDay` 规则）。
- 单测：`directive-draft.test.ts`(7) + `schedule-plan.test.ts`(6) 通过。

### 待办（按依赖顺序，尚需继续）

1. **Phase 2（`cogito-mcp`）**：`crates/mcp`（rmcp stdio）+ `src-tauri/src/bridge/{mod,http}.rs`（axum loopback + token）+ `crates/core/src/tools/{mod,calendar,workspace}.rs` + 打包链（`tauri.conf.json` externalBin、`build.rs` 必检、`scripts/.../sidecar/targets/client.ts`、CI 占位）。**这是 Phase 3 之后所有「agent 读真实数据」能力的前置**。
2. **Phase 5**：`knowledge::Service`（文件为准 + DB 快照 + FTS 重建 + staging 原子提交）、`app_knowledge_*` 工具、检索（trigram + `<3 字符` → `LIKE` 回退 + RRF）、生成/发布 UI。
3. **Phase 6/7/8**：云端 RAG（compute `assetIDs` 过滤 + service `/rag/search` + 客户端上传/索引 + RRF）、自动化（A 客户端 worker / B goose schedules / C 服务端 `scheduled_job`）、导出收尾与文档。

### 待决问题（需你拍板）

1. **服务端调度身份**（Phase 7C 前置）：`runAsUserID` 代跑（需校验租户成员）还是租户服务账号？不选则 7C 不成立。
2. **goose schedules**（Phase 7B）：是否允许依赖 `_goose/unstable/schedules/*`？不通就只保留 A/C。
3. **studio 覆盖安装**：`drizzle/migrations/0000_init.sql` 只对新库生效，本地 dev 需要删 studio 库重建；要不要我加一条 dev 脚本来做这件事？
4. **service 枚举破坏性变更**：`Component::Knowledge` 已改并同步了 `openapi.d.ts`；若有外部（镜像/旧客户端）依赖 `Markdown`，需要确认是否要保留别名。
5. **`views/knowledge` 里 tiptap 相关符号仍叫 `Markdown*`**（`MarkdownViewMode`、`parseMarkdown`、`serializeHtmlToMarkdown`、`markdown` 字段）：按「只改 id 与文案」的边界保留，如希望连内部符号也统一，我再做一轮。

