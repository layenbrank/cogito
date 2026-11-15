# 桌面端 agent 编排：循环宿主搬到 agentd（LangGraph.js + Agent Protocol）

> 目标：桌面端（`apps/client`）的 agent 循环目前由「Tauri 主进程管 goose 进程 + 渲染进程做 ACP client」
> 共同持有。这个形状把**审批、刷新恢复、后台回合、子代理**四件事揉进一个 2200+ 行的
> `features/agent/acp/session.ts`，且进程生死绑定在 Tauri 主进程上——关窗口就等于丢循环。
> 结论：新增 Node 侧车 **`apps/agentd`** 作为**唯一的循环宿主**（`goose acp` stdio + LangGraph.js），
> 前端退回「只消费流 + 只做 UI」，通过 Agent Protocol（HTTP/SSE）与它对话。

> **这是一条 supersede 记录**。它 supersede [`no-langchain.md`](./no-langchain.md) 的**适用范围**，
> 不推翻其结论：compute 的 Python 运行时仍然自持薄层；而 `no-langchain.md` §5 写下的两条触发条件
> （「循环的宿主从 Rust 编排搬回脚本侧」「需要图状/多智能体工作流」）正是本次的入口，
> 所以本记录必须回答它当时留下的三个前置问题——见 §3。
> 同时它**不改动** [`durable-execution-engine.md`](./durable-execution-engine.md) 与
> [`approval-channel.md`](./approval-channel.md)：服务端的可靠执行与审批通道原样保留。
> 上游事实与仓库事实于 2026-11-15 逐条核对（来源见 §7）。

## 0. 候选对照

| 候选 | 形态 | 结论 |
| --- | --- | --- |
| **A. 现状**：Tauri 管 `goose serve --tls`，渲染进程经 Rust WSS 桥做 ACP client | 循环存活期 = Tauri 主进程；恢复靠 `session/load` 重放 + 空闲超时启发式；后台回合靠 `localStorage` 镜像 + Rust 事件环 | 保留到 `agentd` 灰度完成；问题见 §2.1 |
| **B. `apps/agentd`（Node）+ `goose acp`（stdio）+ LangGraph.js + Agent Protocol** | 循环常驻侧车；图节点负责编排、goose 负责推理与工具；前端只消费 SSE | **采用** |
| C. `apps/agentd` + 自写循环（不引 LangGraph） | 侧车化保留，编排手写 | 不采用：`interrupt`/`resume`/checkpoint 就是这次要买的东西，手写等于重实现一遍 §2.2 的三张牌 |
| D. 保留 Rust，在服务端 duroxide 里加 plan/review 工作流 | 复用 `apps/service/src/orchestrations/agent.rs` | 不采用（**仅桌面端**）：那是**云端**编排，桌面会话需要离线可用、工作区在本地、模型凭据在本机；把它作为云端能力保留，两者不合并 |
| E. LangGraph Platform 自托管 | 官方 server | 不采用：企业许可证，与本仓「一个 Postgres / 一个进程」的取舍相反 |

## 1. 五条约束（是「我们的」，不是通用的）

| # | 约束 | 出处 |
| --- | --- | --- |
| 1 | **唯一 LLM 出网点 = `gateway`**：桌面端经 `cogito` provider → corex/路由 → gateway | `apps/client/src-tauri/src/utils/cogito_provider.rs`、`services/gateway/README.md` |
| 2 | **「这个工具要不要人批」只能有一个判定实现** | `features/agent/approval.ts`（`:203-416` 纯函数段）、`tool-risk.ts`、`agent-tools.lock.json` |
| 3 | **聊天历史唯一真相 = 客户端 SQLite**（`agent_session`/`agent_message`，经 Rust IPC） | `shared/ipc/channels.ts`、`port/thread-history.ts` |
| 4 | **桌面生命周期归 Rust**：进程树回收靠 Windows Job Object + `taskkill /T`，前端无 `shell:` 权限 | `utils/child_job.rs`、`app/bootstrap.rs:257`、`capabilities/desktop.json` |
| 5 | **打包契约是「单个 exe + `-<triple>` 后缀」**，且缺件即硬失败 | `bundle.externalBin`、`scripts/prepare-binaries.ts`、`scripts/commands/features/sidecar/targets/client.ts` |

## 2. 决定性理由

### 2.1 现状不是「可以不动」，而是已经在漏

| 现象 | 机制 | 证据 |
| --- | --- | --- |
| 刷新 WebView 后「这一轮还跑不跑完」不确定 | `session/load` 只保证历史重放；进行中的 prompt 可能随连接断开被 `cancel_token` 取消，恢复只能靠「空闲超时」猜（10s 首窗 + 120s 长窗） | `features/agent/acp/session.ts`、仓库内 goose ACP 能力记录 |
| 后台回合需要一套自建设施 | `background-turn.ts` 把 ACP 消费与 UI `AbortSignal` 解耦，再用 `localStorage` 镜像 running 集合、用 Rust `agentTurn:*` 事件环补帧 | `acp/background-turn.ts:83/93`、`shared/ipc/channels.ts`（`AGENT_TURN`） |
| 关窗口 = 循环消失 | 循环跑在 Tauri 主进程持有的连接上 | `app/bootstrap.rs:202-203`、`goose_serve.rs` |
| 会话控制器持续膨胀 | 审批票据、elicitation、恢复、后台、子代理全部内联 | `acp/session.ts`（2200+ 行），`features/agent` 共 97 源文件 / 43 测试 |

也就是说：**「循环的宿主」实际上一直是 Tauri 主进程**，只是它藏在渲染进程的 ACP client 里。
把它显式搬到常驻侧车是「把已有的隐式宿主显式化」，不是新造一个控制面。

### 2.2 为什么买 LangGraph 而不是自写

框架的三张主牌，恰好对上 §2.1 的三个洞：

| 框架卖什么 | 现状谁在硬撑 | 搬过去之后 |
| --- | --- | --- |
| **人在环（interrupt / resume）** | 自建票据队列 + `TICKET_TIMEOUT_MS=300_000` + 幂等结算 | 图里 `interrupt()` 作为**传输**，判定仍走 §1 约束 2 的同一份 policy 代码 |
| **可恢复的会话状态** | `session/load` 重放 + 空闲超时启发式 | checkpoint（`agentd.db`）+ run 事件游标，恢复是**确定的**而非猜测 |
| **图状编排（分支/门控/子图）** | 没有；`plan.ts` 只读 `data:plan` 部件 | `plan → worker → review → humanGate`，子代理可落成 subgraph |

反面：这三件事目前在桌面端**没有第二个权威**（duroxide 只在服务端、且不持有桌面会话），
所以不存在 `no-langchain.md` §2.3 那种「两个权威抢同一件事」的问题。

### 2.3 这里的 checkpoint ≠ 可靠执行

[`durable-execution-engine.md`](./durable-execution-engine.md) 第 19 行把「框架自带 checkpoint」判为不采用，
判的是**服务器上的长任务**。本记录不改那条判断，只划清边界：

- `agentd.db` 的 checkpoint 只承诺**用户体验级续接**：进程重启、窗口刷新、断网后能接着看到同一轮。
- **跨机、跨部署的可靠执行仍归服务端 duroxide**；`agentd` 不做租户级重投递，也不做幂等收敛。
- 因此 `agentd` 的 checkpoint 允许「尽力而为」：崩溃时进行中的 run 记为失败并可重试，而不是重放。

### 2.4 为什么不用 `@skein-js/local`、不引 `better-sqlite3`

| 事实 | 后果 |
| --- | --- |
| `@skein-js/local` 的 `embedSqliteGraphs` 依赖 `@langchain/langgraph-checkpoint-sqlite` | 该包 `1.1.0` 硬依赖 `better-sqlite3@^12.10.0`（原生模块） |
| 本仓 `pnpm-workspace.yaml` 明确 `allowBuilds.better-sqlite3: false` | 装上也不会构建原生件，直接不可用 |
| 桌面产物要按 triple 分发单文件 | 原生 `.node` 需要按 Node ABI + 平台各出一份，SEA 里也塞不进去 |

替代：**`node:sqlite`**（Node 24 内置，无原生模块）+ 自实现 `BaseCheckpointSaver`。
接口收成 3 个方法，万一要换 `better-sqlite3` 只改一个文件（代价是打包退回「Node 目录 + 原生件」）。

### 2.5 为什么前端不引 `@assistant-ui/react-langgraph`

| 事实 | 后果 |
| --- | --- |
| `@assistant-ui/react-langgraph@0.14.40` 依赖 `@assistant-ui/core ^0.3.34`、`store ^0.3.23`、`assistant-stream ^0.3.57`；本仓 catalog 是 `@assistant-ui/react ^0.15.32`（对应 core `0.3.32`） | 引入即需连带升级，而 0.15.x 近期有破坏点 |
| `useLangGraphRuntime` 自带 thread/state/消息模型 | 会与 `useRemoteThreadListRuntime` + `ThreadHistoryAdapter` 争「线程与历史的权威」 |

本仓已有可复用的单向适配：`packages/chat/src/adapters/chat-model.ts` 的 `createChatModelAdapter`
能把 `ChatStreamEvent` 增量聚合成 assistant-ui 快照，**文本、推理、工具调用、审批回执都已实现**。
因此只需实现一个 `ChatModelPort`（Agent Protocol SSE → `ChatStreamEvent`），
`views/agent/chat/runtime.tsx`（`useLocalRuntime` + `useRemoteThreadListRuntime`）一行不动。

## 3. 回答 `no-langchain.md` 留下的三个前置问题

| 问题 | 本记录的答案 |
| --- | --- |
| **幂等键由谁承担** | 桌面端**不做**跨进程幂等收敛：`agentd` 只保证「同一 `thread_id` 的 run 单飞」，崩溃时把进行中的 run 标记失败并允许重试。真正的幂等键仍是服务端 duroxide 的 `ctx.instance_id()`（不变） |
| **租户 / 多工作区策略由谁承担** | 桌面端只有「本机单用户 + 多工作区」：工作区由 `session/new` 的 `cwd` 决定，`agentd` 不引入租户概念；`thread_id` 与客户端 SQLite 的 `agent_session.id` 一一对应，不存在跨用户可见性 |
| **审批闸门由谁承担** | 唯一判定在 `@cogito/agent-protocol/policy`（从 `approval.ts` 纯函数段 + `tool-risk.ts` 下沉）；`interrupt` 只是**传输载体**。服务端的 `approval-channel.md`（决定走邮箱）继续独立生效，两者不共享数据 |

**仍未定的一项**：子代理（现状 `goose subagent` 工具 → `cogito-mcp` → Rust 任务板 → 渲染侧跑一轮）。
goose 离开渲染侧后这条链断开。默认走「改为图内 subgraph」，最终决定在 P5 落地前记录于本文件。

## 4. 引入之后必须守住的不变量

| # | 不变量 | 由什么保证 |
| --- | --- | --- |
| 1 | 唯一出网点 = gateway | 图节点**不直连 LLM**；`planNode`/`reviewNode` 都是 goose 子会话 |
| 2 | 审批判定只有一份实现 | `@cogito/agent-protocol/policy` 是唯一允许写「要不要人批」的地方 |
| 3 | 聊天历史单写者 = Rust SQLite | `agentd` 只写自己的 `agentd.db`（run/checkpoint/映射），不碰 `agent_message` |
| 4 | 前端只有一条 runtime 通路 | 切换缝在 `port/instance.ts` 的 `chatModelPort`；flag 关闭即返回旧实现 |
| 5 | 进程树必须可回收 | `agentd` 被 Tauri 收养进 Job Object，其 `goose` 子进程继承成员资格；退出走 `taskkill /T /F` |
| 6 | 本机回环请求不走代理 | `agentd` 健康检查与所有 `127.0.0.1` 客户端必须 `no_proxy`（reqwest 会读 Windows 系统代理） |

## 5. 我们接受的代价

- **多一个进程**：冷启动多一次 Node 启动；用 SEA 单文件压到最小，并在窗口显示前完成握手（健康检查通过才算 ready）。
- **多一个上游风险**：`@skein-js/*` 是 `1.0.0-beta.1`（Apache-2.0，2026-11 首次发布，周下载 <150，README 自述 Pre-alpha）。
  缓解：在它外面包一层 `AgentServer` 薄接口，断更时换自建 HTTP/SSE 只改一个文件。
- **`node:sqlite` 仍是 experimental**：实测 WAL、`busy_timeout`、BLOB 往返可用（BLOB 读回为 `Uint8Array`）。
- **SEA 只按 CJS 执行入口**（Node 24.18 实测：ESM main 注入后报 `Cannot use import statement outside a module`，
  栈为 `embedderRunCjs`），且生成 blob 必须 `useCodeCache: false`。因此 `agentd` 的 bundle 输出格式定为 **CJS**：
  没有 top-level await，`import.meta.url` 需换成 `__filename`。实测单平台产物 88.4 MB。
- **ACP 传输从 WSS 换成 stdio**：失去 `goose serve` 的证书指纹握手与 loopback URL 校验（这层保护由「进程管道 + 无网络端口」替代），
  但必须自己保证 NDJSON 分帧、UTF-8、背压与子进程回收。
- **删旧是一次性大改**：`acp/connection.ts`、`acp/wss-stream.ts`、Rust `goose_acp.rs`/`goose_tls.rs` 都要退役；
  灰度期必须双轨，旧路径至少保留一个版本。

## 6. 什么情况下重新考虑

1. ~~`@skein-js/*` 连续两个版本无法满足 Agent Protocol 形状，或许可证变更~~ → **已于 2026-11-15 触发**：
   `@skein-js/server-kit` 的传递依赖 `@langchain/langgraph-ui` 含 top-level await（ESM-only），
   与 SEA 只执行 CJS 入口互斥（rolldown 报 `Top-level await is currently not supported with the 'cjs' output format`）。
   已按本条改为**自写 `/threads` / `/runs/stream`**（`@langchain/langgraph` 本身可正常 CJS 打包，实测 2.4 MB）。
2. `node:sqlite` 在目标 Node 版本被移除或行为变更 → 换 `better-sqlite3`，并接受产物从 SEA 退回「Node 目录 + 原生件」。
3. 桌面端出现真实的多用户/多租户需求 → 那时应评估「把桌面会话整体交给服务端编排」，而不是继续加厚 `agentd`。
4. 若 P0 的 S3 spike 证实 `goose acp`（stdio）在能力上明显弱于 `goose serve`（例如 `_goose/unstable/*` 缺失且无法用 admin API 补齐），
   则回退到「`agentd` 只做编排、仍连 `goose serve` 的 WSS」，届时本记录的 §2.5 / §5 需相应改写。

## 7. 后向指针与上游事实（2026-11-15 核对）

| 位置 | 说明 |
| --- | --- |
| [`no-langchain.md`](./no-langchain.md) | 本记录 supersede 其**适用范围**；compute 的结论继续有效 |
| [`durable-execution-engine.md`](./durable-execution-engine.md) | 服务端可靠执行不变；本记录 §2.3 划清 checkpoint 的边界 |
| [`approval-channel.md`](./approval-channel.md) | 服务端审批通道不变；桌面端闸门唯一性见 §3 |
| [`security-boundary.md`](./security-boundary.md) | 记录过 `goose://status` 三态事件；该契约将同构替换为 `agentd://status`，实施时需同步修订 |
| [`../../apps/client/src/features/agent/acp/session.ts`](../../apps/client/src/features/agent/acp/session.ts) | 现行桌面端会话控制器（迁移基线） |
| [`../../apps/service/src/orchestrations/agent.rs`](../../apps/service/src/orchestrations/agent.rs) | 服务端编排（边界参照物，不合并） |

上游事实：

- **`goose acp`** 确实是 stdio ACP server：对仓库 pin 的二进制实测
  `goose-x86_64-pc-windows-msvc.exe acp --help` 输出 "Run goose as an ACP agent server on stdio"，
  选项为 `--with-builtin` 与 `--enable-scheduler`。进一步实测（2026-11-15）其能力面与 WSS 等价：
  `loadSession: true`、`sessionCapabilities = {list, delete, close}`（无 `resume`）、
  `_goose/unstable/{config/extensions/list, defaults/read, diagnostics/get, providers/list, session/system-prompt/set}` 均可在 stdio 下调用，
  `session/load` / `session/close` / `session/list` 均存在。
  **硬约束**：`session/new` 在创建时就要求 provider + model 可解析，否则报
  `-32603 Failed to resolve provider and model: Configuration value not found: GOOSE_PROVIDER`。
  本仓 pin 的 goose 版本见 `scripts/commands/features/sidecar/tools.lock.json`（`v1.57.0`）。
- **`@langchain/langgraph-checkpoint-sqlite@1.1.0`**：`dependencies` 只有 `better-sqlite3 ^12.10.0`。
- **`@skein-js/express` / `@skein-js/server-kit` / `@skein-js/local`**：`1.0.0-beta.1`，Apache-2.0，
  提供 `skeinRouter` / `embedInMemoryGraphs` / `embedSqliteGraphs`；官方仓库带 `examples/desktop-tauri`。
- **`@assistant-ui/react-langgraph@0.14.40`**：`dependencies` 含 `@assistant-ui/core ^0.3.34`、`@assistant-ui/store ^0.3.23`、
  `assistant-stream ^0.3.57`；peer `@langchain/langgraph-sdk ^1.9.20`。
  本仓 catalog 为 `@assistant-ui/react ^0.15.32`（最新 `0.15.36` 才带 core `^0.3.35`）。
- **`@agentclientprotocol/sdk`**：本仓根 `package.json` 锁 `1.7.0`（catalog 另有 `1.8.0` 覆盖），
  上游最新 `2.7.0`，新增 `./experimental/node`（node-adapter）与 `./experimental/ws-client`。
- **仓库事实**（Node 版本、turbo task 名、打包链路、事件契约）以本次提交时的 `master` 为准；详见
  [`.cogito/plans/findings.md`](../../.cogito/plans/findings.md)。
