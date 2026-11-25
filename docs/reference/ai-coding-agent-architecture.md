# AI 编码 Agent 行业架构对照（2026-11-23）

> 目的：为 Cogito 桌面端 agent 的目标架构提供外部依据。只回答「别人怎么做、为什么」，
> 不评价产品优劣；Cogito 的取舍见 `docs/decisions/agent-*.md` 与
> `docs/apps/client/agent-fix-roadmap.md`。
>
> 取证方式：抓取官方文档（链接见文末），访问日期 2026-11-23。未抓到的页面明确标注「未取证」。

## 0. 一句话结论

五个成熟实现在五件事上是收敛的，而这五件事正好对应 Cogito 审查中的 P0：

| 共性 | 代表实现 | 对应 Cogito 缺陷 |
| --- | --- | --- |
| 会话事件是**持久、可重放**的日志 | OpenHands EventStream、Codex rollout / app-server | F-003 事件只在内存环形缓冲 |
| 审批是**持久请求**，可重连重放、幂等结案 | Codex app-server approval replay、VS Code scoped approvals | F-004 / F-005 审批卡消失、假成功 |
| **审批与沙箱正交**：批准不扩大访问 | VS Code Copilot approvals、Codex sandbox policy | F-001 白名单可撤销硬禁用 |
| **单一 runtime + 平台薄适配** | VS Code harness 抽象、Codex app-server | F-025 / F-040 多套状态机与分类器 |
| 多客户端**显式单写者 / revision** | VS Code 外部会话「一次只允许一个应用写」、Codex `expectedRevision` | F-026 同一 thread 两端都能写 |

## 1. 八维对照矩阵

| 维度 | VS Code / Copilot | Cursor | Codex CLI / app-server | Cline | OpenHands |
| --- | --- | --- | --- | --- | --- |
| 会话与执行模型 | session → chat → turn；Chat view 与 Agents window 共享会话 | Agent = instructions + tools + model；chat 为主，Projects 由 coordinator 分派 | app-server：thread / turn 两级；`thread/resume`、`thread/fork` | 单 task 循环，任务历史持久化 | Agent + EventStream；Action → Observation |
| 事件与恢复 | 会话可恢复、可 fork、可导出；上下文压缩为摘要 | checkpoint 快照（文件级），恢复文件不改消息 | rollout 持久化；thread resume/fork；pending 审批重放 | checkpoint 跨编辑器会话持久 | EventStream 派生 State，运行可恢复 |
| 审批模型 | 三档权限（Manual / Assisted / Allow all）；审批作用域 once / session / always；命令规则支持前缀与锚定正则 | Run Mode 决定何时询问；终端 sandbox 独立 | 审批预设与沙箱档位绑定；审批请求带唯一 id，重连重放，无连接则拒绝 | 按类别 auto-approve；模型标注 `requires_approval`；YOLO | 确认模式（总是 / 从不 / 风险操作）+ Docker 沙箱 |
| 沙箱 | 沙箱限制文件与网络；**批准命令不扩大沙箱权限**；可要求组织级强制 | 终端 sandbox 阻断未授权文件/网络 | OS 级：Seatbelt / bubblewrap+seccomp / Windows restricted token；策略与审批正交 | 无内置 OS 沙箱，靠 checkpoint 兜底 | Docker 容器 + Action Execution Server |
| 上下文 | 七层组装（系统/定制/用户/历史/隐式/显式/工具输出）；自动压缩 + `/compact`；语义索引 | 规则（rules）+ 代码库检索；计划模式先研究再执行 | 自动压缩；managed requirements 可强制 | 会话截断 + 新任务交接 | 上下文 condensation（摘要） |
| 子代理 | 独立上下文窗口，结果回主会话；上下文隔离 ≠ 代码隔离 | Projects coordinator 派生子代理 | 内部 worker（如 Guardian reviewer）；owner 控制生命周期 | 子任务 / orchestrator（社区模式） | 多 Agent 委派 |
| 并发与多客户端 | 同一外部会话**一次只允许一个应用写**；否则提示另一应用占用 | 会话内 queue / steer；并行 agent 用独立 worktree | read state 用 `expectedRevision` 乐观并发；多连接共享 thread | 单编辑器为主 | 单后端 + EventStream |
| 扩展与工具协议 | MCP + 扩展贡献工具；custom agents 声明工具集 | MCP；rules 可被工具拉取 | MCP；app-server JSON-RPC；managed MCP 策略 | MCP | MCP + Runtime 插件 |
| 运行时位置 | 扩展宿主 / Agent Host / 云沙箱 | 本地 / 云端 background agent | 本地 CLI / app-server / 云 | 编辑器扩展宿主 | 后端 + 容器 Runtime |

## 2. 逐产品要点

### 2.1 VS Code / GitHub Copilot

来源：`code.visualstudio.com/docs/agents/run/approvals`、`.../concepts/context`、
`.../run/sessions/manage-sessions`、`.../chat/chat-overview`。

- **审批与沙箱分离**：文档明确「Approving a command lets it run but doesn't expand its access.
  Sandboxing limits which files and network destinations the command can access」。
  即使选 Allow all，也不能写沙箱标记为只读的目录。
- **权限三档**：Manual（默认）/ Assisted（模型评审，可给指令）/ Allow all。
  Autopilot 是「持续工作模式」，**不是第四档权限**。
- **审批作用域**：Allow Once / In this Session / Always Allow；Always Allow 存在 Agent Host，
  重启后仍有效，可管理、可撤销。
- **命令规则**：`chat.tools.terminal.autoApprove` 支持命令前缀与锚定正则，可 `matchCommandLine`；
  优先级链是「policy 阻断 > runtime 自动批准 > 显式 ask 规则 > 已保存批准 > 内置默认」；
  文档强调命令匹配是 best effort，真正限制访问要靠沙箱。
- **会话模型**：session 分组 workspace + 变更 + 多个 chat；支持 fork（含从某 checkpoint 起 fork）、
  side chat（`/btw`）、嵌套 session；外部应用会话有「一次只能一个应用写」的互斥提示。
- **上下文**：七层组装；上下文窗口控制显示 token 与分类；自动压缩 + `/compact`；
  子代理拥有独立上下文（上下文隔离不等于代码隔离）。
- **运行中交互**：Add to Queue / Steer with Message（在当前工具执行结束后让出）/ Stop and Send；
  停止不撤销已完成操作，需用 checkpoint 恢复。
- **可观测**：Agent Logs 与 Chat Debug view（原始 system prompt、工具载荷）。

### 2.2 Cursor

来源：`cursor.com/docs/agent/overview`、`.../plan-mode`、`.../terminal`。

- Agent = instructions（system prompt + rules）+ tools + model；工具含搜索、读文件、编辑、
  终端、浏览器、图片生成、提问。
- **checkpoint**：Agent 在重大改动前自动打快照，存本地、与 Git 分离；可按 checkpoint 预览并恢复文件，
  恢复**不回滚消息**。
- **Plan Mode**：先提问澄清 → 研究代码库 → 产出可编辑计划 → 用户确认后执行；
  计划默认存家目录，可「Save to workspace」。
- **终端**：命令直接跑在用户终端；Run Mode 决定何时询问、何时进 sandbox；sandbox 阻断未授权文件与网络。
- **并发交互**：queue、Send now（追加到最近 user 消息立即处理）、steer（在下一个工具调用边界注入，
  不打断进行中的动作）。
- **长目标**：`/goal` 给出跨多轮的目标；`/loop` 周期性重跑 skill。
- **Projects**：coordinator agent 规划并分派给多个 agent（子代理 / 并行工作）。

### 2.3 OpenAI Codex（Apache-2.0）

来源：`github.com/openai/codex` 的 `codex-rs/app-server/README.md`、`codex-rs/core/README.md`；
`developers.openai.com/codex/*` 在本次抓取中返回 403（未取证），故只引用仓库内文档。

- **app-server 是 thread / turn 的 JSON-RPC 服务**：IDE 与 CLI 共用；支持 `thread/start`、
  `thread/resume`、`thread/fork`、`turn/start`、`turn/interrupt`、`review/start` 等。
- **审批 replay**：带人审批的命令请求有唯一 `approvalId`；能力匹配的客户端重连时
  「pending prompts use the normal approval replay flow」；**若无能力连接，直接拒绝命令**。
- **read state 乐观并发**：`{firstUnread, revision}`；`thread/readState/update` 要求
  `expectedRevision` 精确匹配，冲突返回 `readStateConflict`，并明确「不要盲目重试」。
- **沙箱是 OS 级且与审批正交**：macOS Seatbelt、Linux bubblewrap + 网络命名空间（缺 bwrap 时用内置）、
  Windows restricted token / 新版 MXC；`workspace-write` 下 `.git` 与 `.codex` 保持只读。
- **持久化**：thread rollout 落盘、可压缩；`thread/items/list` 支持 item anchor 分页；
  历史与实时通知返回同一种 `ThreadItem`。
- **managed requirements**：管理员可强制审批策略、网络域、沙箱实现，用户配置不可覆盖。
- **错误分类**：`TurnAborted.error.codexErrorInfo` 等结构化字段，客户端按 code 分支而不是文案。

### 2.4 Cline

来源：`docs.cline.bot/features/checkpoints`、`.../features/auto-approve`。

- **shadow Git checkpoint**：每次工具调用后把工作区状态提交到独立仓库；主仓库不受影响；
  可恢复「文件 / 对话 / 两者」三种粒度。checkpoint 让 auto-approve 变得可接受。
- **按类别 auto-approve**：读项目文件、读所有文件、改项目文件、改所有文件、安全命令、所有命令、
  浏览器、MCP；「所有文件」必须基础开关先打开。
- **命令安全判定**：没有固定白名单，由模型给每条命令标 `requires_approval`；
  文档明确这是示例不是保证。
- **YOLO 模式**：全放行，文档显著警告风险，建议只在隔离环境使用。

### 2.5 OpenHands

来源：`docs.openhands.dev/openhands/usage/architecture/{backend,runtime}`。

- **EventStream 是核心**：Agent 产出 Action，经 Runtime 执行得到 Observation，全部进入事件流；
  State 由事件派生。前端通过 HTTP/WS 订阅事件。
- **Docker Runtime**：Action Execution Server 在容器内执行 shell / Python / 浏览器 / Jupyter；
  后端与 runtime 通过 REST 通信；镜像用三级 tag（source / lock / versioned）做可复现构建。
- **Sandbox 的目的**：执行不可信代码、保证一致性、限制资源、隔离项目、可复现。
- **插件化 Runtime**：Jupyter、VS Code（带 token 的 URL）、Agent Skills 都作为插件初始化。

## 3. 五个可迁移的结论

### 3.1 事件日志是持久真相，不是 UI 缓冲

OpenHands 把 EventStream 当唯一事实来源；Codex 把 rollout 落盘并支持 resume/fork。
一旦事件只在内存环形缓冲，断线与重启就必然导致「静默缺段」，而 UI 只能猜。
**迁移**：`run_events` 真写 + `(epoch, seq)` + `sync.truncated`（ADR: agent-run-event-log）。

### 3.2 审批是一等持久请求

Codex 的 `approvalId` + replay + 「无连接则拒绝」，VS Code 的 once/session/always 作用域，
都说明审批不是「推一条事件就完事」。
**迁移**：agentd 持久 pending set、幂等 settle、结案广播、超时/崩溃批量结案（ADR: agent-approval-service）。

### 3.3 审批与沙箱正交

VS Code 的「批准不扩大访问」和 Codex 的 OS 级沙箱是同一原则的两种实现：
审批回答「谁同意」，沙箱回答「最多能碰什么」。只靠工具名黑名单（Cogito 现状）既挡不住未知工具，
又会被同一条配置面改回来。
**迁移**：硬禁用升级为 agentd 侧工具闸门；`permissions/set` 移出公开白名单；
中期评估 Windows 受限令牌 / AppContainer（ADR: agent-policy-enforcement）。

### 3.4 单一 runtime + 平台薄适配

VS Code 用 harness 抽象隔离 Copilot / Claude / Codex；Codex 用 app-server 让 TUI / IDE / 云端共用一套核心。
Cogito 目前 client 与 extension 各写一份 run 循环，差异只有 cwd / MCP / 恢复能力。
**迁移**：`runTurn` 上提到 `@cogito/agent-runtime`，两端只传 capability（ADR: agent-run-state-machine）。

### 3.5 多客户端要显式单写者与 revision

VS Code 对外部会话直接互斥；Codex 用 `expectedRevision` 解决并发读状态。
Cogito 桌面 + 扩展可同时写同一 thread，审批账本各自为政。
**迁移**：server-side writer lease（带 revision），审批结案走广播而不是本地 take。

## 4. 采用 / 借鉴 / 不适用

| 做法 | 决策 | 理由 |
| --- | --- | --- |
| 持久事件日志 + epoch 游标 | **采用** | 直接修复缺段/重启不可恢复；成本可控 |
| 审批持久化 + 重放 + 广播 | **采用** | 直接修复审批卡消失/假成功 |
| 单一 run 状态机 | **采用** | 消除两端行为分裂 |
| 工具级策略闸门 + 配置面收敛 | **采用** | 修复硬禁用可被撤销 |
| 文件级 checkpoint（恢复文件与对话） | **借鉴，后续** | 与「历史唯一真相在 SQLite」不冲突，但需要新的快照存储与 UI |
| OS 级沙箱 | **借鉴，分期** | Windows 上成本高；先做命令策略 + 目录白名单，沙箱列为 R5 |
| 云端 background agent | **不适用（本期）** | 产品定位是本地单用户、唯一出网点 gateway |
| 模型评审审批（Assisted） | **借鉴，后续** | 需要额外模型调用与策略，先保证确定性档位 |
| 多 worktree 并行 agent | **不适用（本期）** | 与当前单工作区模型冲突，且需要 Git 工作树管理 |

## 5. 来源

- VS Code：<https://code.visualstudio.com/docs/agents/run/approvals>
- VS Code：<https://code.visualstudio.com/docs/agents/concepts/context>
- VS Code：<https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions>
- VS Code：<https://code.visualstudio.com/docs/chat/chat-overview>
- Cursor：<https://cursor.com/docs/agent/overview>
- Cursor：<https://cursor.com/docs/agent/plan-mode>
- Cursor：<https://cursor.com/docs/agent/terminal>
- Codex：<https://github.com/openai/codex>（`codex-rs/app-server/README.md`、`codex-rs/core/README.md`、`docs/config.md`、`docs/sandbox.md`）
- Cline：<https://docs.cline.bot/features/checkpoints>
- Cline：<https://docs.cline.bot/features/auto-approve>
- OpenHands：<https://docs.openhands.dev/openhands/usage/architecture/backend>
- OpenHands：<https://docs.openhands.dev/openhands/usage/architecture/runtime>

> 未取证：`developers.openai.com/codex/*`（本次返回 403）、Cursor 的 `security/run-modes`
> 与 `rules` 页面（404）。相关结论只采用仓库内或已抓取页面能直接支持的部分。
