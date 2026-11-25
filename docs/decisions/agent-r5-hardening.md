# ADR：R5「加固」的正确形状（不是给可见终端套沙箱）

- 状态：**提议（2026-11-23，待确认）**；D3 的前提已实测（见 §2.1）
- 关联：[agent-audit.md](../apps/client/agent-audit.md) 0.6、[agent-fix-roadmap.md](../apps/client/agent-fix-roadmap.md) R5、
  [security-boundary.md](./security-boundary.md)、[agent-policy-enforcement.md](./agent-policy-enforcement.md)
- 前置：R0–R4 已全部收口（安全 / 数据完整性 / 卡死 / 正确性 / 收敛）。本 ADR 处理路线图里剩下的一栏。

## 1. 背景

路线图的 R5 原文是「评估 Windows 受限令牌 / AppContainer 包装 `local__cogito_terminal_run`」。
逐项对到代码后发现，这条默认方向是**错的**：它会把产品承诺当漏洞来堵，同时放过真正该收口的东西。

| 事实 | 证据 |
| --- | --- |
| 可见终端**本来就是**用户身份的终端，用户要在里面跑自己的命令、随时接管，这是产品承诺 | `docs/apps/client/agent-terminal.md`：「终端不是沙箱：命令以用户身份执行」；`bridge/app_tools.rs` 的工具说明「跑在用户右栏看得见的终端里」 |
| 它的风险已经走审批：`cogito_terminal_run` 归 write 档，任意审批档下都不是静默放行 | `packages/agent-protocol/src/policy/tool-effect.ts`、`approval.test.ts` |
| agent 能拿到的**任意可执行**面被收窄到两条白名单 MCP（`corex-mcp` / `cogito-mcp`），外部命令需显式 `AGENTD_MCP_ALLOW_ARBITRARY=1` | `apps/agentd/src/validation.ts`、`apps/agentd/README.md` 环境变量表 |
| goose 内置写工具（`text_editor` / `write` / `edit` / `shell`）在审批层是 `never_allow`，与审批档无关 | `packages/agent-protocol/src/policy/approval.ts::findHardDenyLevel` |
| 进程树回收已有内核级兜底：agentd 被 Tauri 收进 Job Object（`KILL_ON_JOB_CLOSE`），goose 与 MCP 继承成员资格 | `apps/client/src-tauri/src/utils/child_job.rs`、`utils/agentd.rs` |
| 渲染进程**持有** agentd 的 endpoint + bearer token | `agentd:endpoint` 命令；`features/agent/port/agentd-connection.ts` |

由此得出两条判断：

1. **沙箱化可见终端等于砍功能**。它解决的是「用户自己敲的命令不安全」，而用户要的就是这个终端。
   真要限制 agent 的命令面，正确做法是审批 + 硬禁 + 工具白名单（已做）。
2. **渲染进程持有的任何「约束声明」都不是边界**。cwd 允许根、工具白名单如果由渲染进程传入/声明，
   它自己就能绕开。可信侧只有 Rust。

## 2. 决定

### D1 · 不给可见终端套沙箱；改为把威胁模型写清

- `cogito_terminal_run` 保持 write 档 + 审批，**不**包 AppContainer / 受限令牌。
- 审批卡与产品文档必须直说「这条命令以你的身份执行、没有沙箱」（`agent-terminal.md` 已有该句，
  审批卡的说明文案在 R5-T1 补齐）。
- 触发条件：只有当日志/支持渠道出现「agent 在用户不知情时跑了命令」这类事件，才回头讨论沙箱；
  那时也应该先查审批档是否被改成了 `auto`。

### D2 · cwd 约束（若要做）只能在可信侧做

保持 audit 0.6 的现状决策（不注入静态根表）。将来若确实需要「cwd 只能落在工作区里」，唯一正确的做法是：

- Rust spawn agentd 时给一把**只留在 Rust 进程内**的 admin token（`AGENTD_ADMIN_TOKEN`，**不**经
  `agentd:endpoint` 交给渲染进程）；
- agentd 只接受带 admin token 的 `PUT /admin/roots`（增删工作区根），bearer 那侧只读；
- 根表变化来源：Rust 的工作区增删事件（`workspace:changed` 一类），**不是**渲染进程的请求体。

代价：一个管理员通道 + 一份动态根表。收益：只挡「本端代码写错」。**结论：暂不做**，
写在 ADR 里是为了把「以后要做成什么样」定死，免得下次又回到「让渲染进程传一个数组」。

### D3 · 「事件缺段后重建正文」是 R5 里唯一真正值得做的一项

`sync.truncated`（`after` 落在已淘汰区）目前只有诊断告警 + 让用户重发（audit 0.6）。
补正文的正确来源是 goose 自己的会话历史，**不能用** checkpoint 的 `reply`（只有最后一轮）。

#### 2.1 前提已实测（2026-11-23，goose 1.48.0，`apps/agentd/scripts/probe-replay.ts`）

探针脚本已进仓库（`pnpm --filter @cogito/agentd exec node --experimental-strip-types scripts/probe-replay.ts [--tools]`），
结果推翻了三个猜测、确认了一个限制：

| 事实 | 实测结果 | 对实现的影响 |
| --- | --- | --- |
| `loadSession` 能力 | `initialize` 报 `true`；`sessionCapabilities={list,delete,close}`（**没有 `resume`**） | 只能走 `session/load`，别再想 `session/resume` |
| `messageId` 是否稳定 | **稳定**：实时流的 `messageId` 在重放里逐字相同（新出现的只有用户消息 `msg_*`） | 客户端可以按 `messageId` 幂等合并，不会重复渲染 |
| 工具调用/结果 | **都在**：`tool_call` + `tool_call_update`（含 `status=completed` 的内容），`toolCallId` 与实时一致 | 卡片也能补，不只正文 |
| 重放粒度 | **按消息聚合**：实时 373 条 chunk（thought 295 + text 51）→ 重放 22 条，每条消息一段完整文本 | **不能 append**：必须按 `messageId` **替换**整段文本，否则正文翻倍 |
| 顺序 | 22 条重放通知**全部先到**，`session/load` 的 response 最后到 | 以 response 作为「补完」信号；agentd 在 response 前落库+广播 |
| 噪声 | 重放里也有 `usage_update` / `available_commands_update`（`session_info_update` 视情况） | 客户端过滤，只吃 `*_chunk` / `tool_call` / `tool_call_update` |

#### 2.2 实现方案

> **进度（2026-11-23）**：**D3 已全链路落地**。
> - 服务端：`POST /threads/:id/replay`（`replay.test.ts` 5 例：正常转发/过滤噪声/会话隔离/`run_active` 409/502 旁路/404）；
> - 事件层：`RunEventKind` += `replay`；
> - 协议层：`parseRunFrame` 识别 `replay` 帧（`runs.test.ts`）、`TurnItem{kind:'replay'}`、
>   `AcpStreamContext.replace` 把覆盖语义打到 `text`/`reasoning`（`acp/stream.test.ts`）；
> - chat 层：`ChatStreamEvent` 的 `text`/`reasoning` 新增 `replace`，累积器按 `kind:blockID` 改写
>   （同消息被工具拆成多块时归并到第一块、其余清空）（`chat-model.test.ts` 3 例）；
> - 客户端触发：`runThreadPrompt` 的 `sync.truncated` → 记意图、**本轮收尾后**再发起（那时才没有活跃轮）；
>   `resumeThreadRun` 的 `sync.truncated` → 立刻发起（它没有自己的活跃轮，重放事件回到同一条 SSE 直接合入）；
>   请求带 60s 节流，409/502 一律降为诊断告警（`agent.session.replay`）。

| 步骤 | 内容 |
| --- | --- |
| 1 | agentd 新增 `POST /threads/:id/replay`：读取该 thread 已绑定的 goose session（无绑定 → `no_session`）；**该 thread 有活跃 run 时返回 `409 run_active`**（`session/load` 会 attach 会话，与 live 流打架的风险不能赌） |
| 2 | 调 `session/load({ sessionId, cwd, mcpServers })` 收集重放通知；`mcpServers` 用 `findSessionMcpServers` 的同一份名单（`session/new` 与 `load` 不许漂移） |
| 3 | 把通知映射成事件 `kind: 'replay'`（`payload` 与 `update` 同形），写入 `run_events`（seq 接在当前游标之后）并广播；接口响应 `{ replayed: n }` |
| 4 | 协议层（`@cogito/agent-runtime`）把 `replay` 帧透出成 `TurnItem{kind:'replay'}`；`ChatStreamEvent` 的 `text` / `reasoning` 增加 `replace?: true`，`packages/chat` 的累积器按 `kind:blockID` 找到已有块**改写文本**（找不到才新建），工具块按 `toolCallId` 原地回填 |
| 5 | 客户端触发点：只在**没有自己的活跃轮**时（`resumeThreadRun` 观察到 `truncated` 且该轮已终态 / 本轮结束后补一次），失败一律降级为诊断告警 —— 不允许因为补历史让这一轮报错 |

**已知取舍**：一条消息若在工具前、工具后各有一段文本，重放会聚合成一段文本，替换后前段位置（相对工具卡）
会归并到第一块。这是「补历史」路径的保真损失，可接受；正常流式渲染不走这条路。

验收：
- 探针（`probe-replay.ts`）在 CI 外留档：`messageId` 一致、工具结果 ≥1、重放条数 << 实时条数；
- 构造「`after` 落在淘汰区」：客户端收到 `truncated` → 触发 replay → 历史消息补全且**不重复**；
- `409 run_active`：并发时客户端不重试、不报错，只留诊断；
- 单测：同一 `messageId` 的 `replace` 事件重复到达幂等；`parseAcpStreamEvent` 对 `replay` 载荷的映射与 live 同形。


## 3. 未来真需要沙箱的触发条件

出现下列任一情形时，另开 ADR 做真沙箱（本 ADR 不覆盖）：

1. 引入 headless shell 工具（不经用户可见终端、无人围观地执行命令）；
2. 放开 `AGENTD_MCP_ALLOW_ARBITRARY`（agent 能拉起任意可执行）；
3. 支持远程/多租户执行（`apps/compute` 那条线）。

落地要点（届时）：Windows 受限令牌 + AppContainer（网络/文件能力按工具声明）、Unix 侧
Seatbelt / bubblewrap；审批与沙箱**正交**（批准不扩大可访问范围）；验收用「沙箱内越权读写必须失败」
的负向用例，而不是只看命令能跑通。

## 4. 与路线图的差异

| 路线图原文 | 本 ADR |
| --- | --- |
| 评估沙箱包装 `cogito_terminal_run` | **不做**（D1：等于砍功能，风险已由审批 + 硬禁 + 白名单覆盖） |
| 审批与沙箱正交，批准不扩大范围 | 保留为未来沙箱的硬约束 |
| （无） | 新增 D2（cwd 约束只能做在可信侧）与 D3（回放通道） |

## 5. 风险

- D3 依赖 goose 的 `session/load` 行为（重放粒度、`messageId` 是否稳定）。**先做验证再写映射**，
  不然会得到一个「补了正文但卡片错位」的半成品 —— 与 audit 0.6 拒绝做半成品的原则一致。
- D2 若将来落地，admin token 一旦泄漏就等于根表失守；它必须与 bearer 分开存储（Rust 进程内 +
  可选 keyring），不进 `agentd:endpoint` 的返回体。
