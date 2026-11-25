# Agent 模块修复路线图

> 输入：[agent-audit.md](./agent-audit.md) 的 F-001…F-040、四份 ADR（`docs/decisions/agent-*.md`）。
> 排序口径：**安全 > 数据完整性 > 用户可感知卡死 > 正确性 > 收敛 > 体验**。
> 每个阶段都要求「代码 + 测试 + 文档」同批完成；没有「先合再补测试」的例外。

## 0. 总览

> **进度（2026-11-23）**：R0 / R1 / R2 / R3 已完成并落地。实际改动面与验收：
> - 配置面：`goose/allowlist.ts` 移除 `_goose/unstable/tools/permissions/set`；
> - 崩溃兜底：`goose/client.ts` 的 `error`/EPIPE 监听与 `safeWrite`；`main.ts` 的 `uncaughtException`/`unhandledRejection`；
> - 取消/关停：`session-registry.ts` + `graph.onSession`、`runID` 归属校验、`closeConnections` + `closeIdleConnections`/`closeAllConnections`；
> - 校验：新增 `validation.ts`（cwd / mcpServers / thread_id / configId / after）；MCP 默认只认产品自带的 `corex-mcp` / `cogito-mcp`，任意外部命令需 `AGENTD_MCP_ALLOW_ARBITRARY=1`；
> - 事件持久化：`event-store.ts` + 迁移 v3 的 `run_events`（主键 `(thread_id, epoch, seq)`），`emit` 先落库再广播，写失败降级 `durable=false`；
> - 审批服务化：`gate-store.ts` + 迁移 v4 的 `gate_requests`，`settle` 幂等 + 跨客户端广播 `approval_settled` / `elicitation_settled`，启动时清理上个进程遗留 pending；
> - 游标落库：`agent_session."lastEpoch"`（迁移 patch 6）+ `SessionBindingSchema.lastEpoch`，取消/报错路径同样落游标；
> - 单一状态机：`@cogito/agent-runtime/agentd/turn` 的 `runTurn` / `pumpTurn`，client 与扩展都只提供 capability 与副作用；补齐 race 丢帧、空闲超时参与等待、首帧前不抛、终态必落游标；
> - 归因上提：`agentd/run-error.ts` 从 client 搬到协议层，两端错误文案一致；`deriveOption` 只认精确 `*_once`（去掉 `/allow/` 兜底）；
> - `/runs/stream` 断连收尾：客户端断开时中止本条 run 并取消 goose（`runs.disconnected` 计数）；
> - 收敛与删除：`packages/agent` 只留 `provider.ts`、`agent-protocol/protocol` 整体删除；工具分类对账（`usesWriteCard` 改名 + 跨模块不变量测试）；`open` / `fetch` 歧义动词移出只读表；agentd 端点表与四份文档对齐代码；
> - 测试：`@cogito/agentd` 21 文件 / 123 例、`@cogito/agent-runtime` 6 / 61、`@cogito/client`（agent 范围）72 / 614、`@cogito/extension` 9 / 33、`@cogito/agent` 1 / 15、`@cogito/agent-protocol` 3 / 24 全绿；Rust `cargo check` + `agent_session` 用例通过。
> - 与计划的差异：保留策略是**按时间**（7 天）而非「字节 + 天数」；`truncated` 只透出标志（正文重建的
>   两条候选路径都不划算，见 audit 0.6）；`sync` 不报「当前 run 终态」（属状态机，R2）；
>   旧格式 `after=epoch:seq` 未实现（改用独立 `epoch` 查询参数，非法值 400）；
>   `AGENTD_ALLOWED_ROOTS` **不由 Tauri 注入**（换不来安全边界、还会误拒 home / 新增工作区，
>   见 audit 0.6；真约束留给 R5）。
> - R2 遗留（已结清）：F-013「模式两个真相」定为**快照优先**（提示词 / goose 档 / 审批判定同源，
>   见 audit 0.6）；扩展端 `lastEpoch` 已在 R4 补齐；`truncated` 后的正文重建已在 R5-D3 落地。

```mermaid
graph LR
  R0["R0 安全与崩溃<br/>1–2 天"] --> R1["R1 事件与审批持久化<br/>2–3 天"]
  R1 --> R2["R2 单一 run 状态机<br/>2–3 天"]
  R2 --> R3["R3 收敛与删除<br/>1–2 天"]
  R3 --> R4["R4 体验与正确性<br/>2–3 天"]
  R4 --> R5["R5 沙箱（可选）<br/>独立立项"]
```

| 阶段 | 目标 | 关联缺陷 | 关联 ADR |
| --- | --- | --- | --- |
| R0 | 关掉「一条 HTTP 就能撤销硬禁用」和「goose 错误导致 agentd 崩」 | F-001 / F-002 / F-006 / F-007 / F-010 | policy-enforcement |
| R1 | 事件与审批变成持久真相 ✅ | F-003 / F-004 / F-005 / F-012 / F-019 / F-026 | run-event-log / approval-service |
| R2 | 两端共用一份 run 状态机，修掉丢帧与假死 ✅ | F-008 / F-009 / F-011 / F-014 / F-029 | run-state-machine |
| R3 | 删死代码、收敛重复实现、对齐文档 ✅ | F-025 / F-027 / F-031 / F-032 / F-033 | 全部 |
| R4 | 目标/计划/后台轮与上下文估算 ✅ | F-015…F-024 / F-026 / F-030 / F-034 / F-037 / F-038 / F-013 | — |
| R5 | 加固（不做终端沙箱；做回放通道 + cwd 可信侧约束的设计） | F-027 残余风险 | policy-enforcement / [r5-hardening](../decisions/agent-r5-hardening.md) |

## R0 · 安全与崩溃（1–2 天）

### R0-1 收敛配置面（F-001）

- 从 `apps/agentd/src/goose/allowlist.ts` 移除 `_goose/unstable/tools/permissions/set`；
- 新增内部写入路径（不经 `/goose/invoke`），只允许写 `never_allow`，写后使 `hardenedSessions` 失效；
- `/goose/sessions/:id/config` 增加 `configId` 白名单；
- 逐项评估 `session/close` / `session/load` 是否应暴露 → **结论**：`session/load` 只在
  `POST /threads/:id/replay` 里用（见 [r5-hardening](../decisions/agent-r5-hardening.md) D3），不再当通用 passthrough；
  `session/close` 仍只由 agentd 内部（换 cwd / 换 MCP 指纹 / 关会话）调用。

**验收**：单测断言该方法经 `/goose/invoke` 返回 404；集成测试断言写入 `never_allow` 后无法被公开路径撤销。

### R0-2 子进程错误兜底（F-002）

- `goose/client.ts` 补 `child.on('error')` / `child.stdin.on('error')` / `child.stdout.on('error')`；
- 写 stdin 前检查 `writableEnded`；
- `main.ts` 加 `uncaughtException` / `unhandledRejection`：记录 + 通知 supervisor + 优雅退出；
- `supervisor.onExit` 通知 `approvals` / `elicitations` 批量结案并广播。

**验收**：fake child 用例覆盖 spawn error、EPIPE、goose exit；进程不崩，票据全部结案。

### R0-3 取消与关停（F-006 / F-007）

- `runTurn` 一拿到 `sessionId` 就写内存映射；`readSessionID` 优先内存；
- `executeRun` 的 `finally` 只在 `activeRuns.get(threadID)?.runID === runID` 时清理；
- `approvals.cancelThread` 改为 `cancelRun(runID)`；
- `shutdown`：先关闭所有 SSE / `closeAllConnections()`，再 `supervisor.stop()`，最后 `server.close`。

**验收**：首轮取消测试断言 `session/cancel` 发出；shutdown 测试断言 `disposeAll` 执行且退出码 0。

### R0-4 会话绑定与输入校验（F-010 与信任边界）

- `fingerprintSession({ cwd, workspaceID, mcpServers, systemText })`；
- `cwd` 存在性 + 允许根校验；`mcpServers` 默认拒绝任意 command；
- `thread_id` 长度/字符集校验，`threads` Map 设上限；
- `after` 只接受严格数字（`epoch` 用独立查询参数），非法值 400，不退化为全量补发。

**验收**：切换工作区后重开会话；非法 cwd/mcpServers 返回结构化 400。

## R1 · 事件与审批持久化（2–3 天）

### R1-1 事件日志（F-003）

按 [agent-run-event-log.md](../../decisions/agent-run-event-log.md)：

- `run_events` 表 + `(thread_id, epoch, seq)` 主键；
- `emit` 先落库再广播；批量写；写失败降级并告警；
- `sync` 扩展 `epoch / minSeq / truncated / run / approvals / elicit`；
- 保留策略按字节+天数；单事件 payload 上限。

**验收**：断流 3000 条后重连正文完整；`after` 落在淘汰区时 `truncated:true`；重启后 `epoch` 变化触发 reset。

**落地**：`event-store.ts`（insert / replay / minSeq / prune / clearThread）；`db.ts` 迁移 v3 重建 `run_events`
并加 `(thread_id, seq)` 索引；`events.ts` 的 `createEventHub({store, epoch, onStoreError})` 在 `emit`
里先落库再广播，落库失败降级为内存并标记 `durable=false`；7 天 `prune` 由 `main.ts` 启动一次 + 每小时
unref 定时器驱动；`AGENTD_EVENTS_READY` / `AGENTD_EVENTS_PRUNED` 进诊断日志。

### R1-2 审批服务（F-004 / F-005 / F-026）

按 [agent-approval-service.md](../../decisions/agent-approval-service.md)：

- `gate_requests` 表 + 状态机；`settle` 幂等 + revision；
- 结案写事件并广播所有订阅者；
- run 结束 / goose 退出 / 超时批量结案；
- `parseRunFrame` 读 `sync.approvals/elicitations`；恢复路径走同一策略判定（F-019）；
- 客户端账本只做 UI 缓存，以服务端结案为准。

**验收**：刷新重建卡片；双客户端一方批准另一方收到 settled；回执失败不 toast 成功；kill goose 无僵尸卡。

**落地**：`gate-store.ts`（insert / settle 只允许 pending → 终态且幂等 / cancelPending / countPending）
+ 迁移 v4 的 `gate_requests`；`approvals.ts` / `elicitations.ts` 的 `finish(..., 'settled' \| 'expired' \| 'cancelled')`
落库并广播新帧；路由改 `settleFor(threadID, requestId)` 校验线程归属与 optionId；
`main.ts` 启动时 `cancelPending` 清理上个进程遗留 pending；client 的 `resolveApprovalTicket` /
`resolveElicitationTicket` 为 live 与 sync 快照共用（同一策略判定，按账本状态去重）。

### R1-3 游标落库（F-012）

- client 的 `runTurn` 在 `finally` 落 `{epoch, seq}`；
- `POST_ACP_BINDING` 增加 `lastEpoch`；
- 扩展同步。

**验收**：取消/报错后刷新，不重放旧 `settled`。

**落地**：client 的 `ThreadSession` 记录 `epoch`，`POST_ACP_BINDING` 传 `lastEpoch`，events URL 带 `epoch`；
Rust 侧新增 `agent_session."lastEpoch"`（迁移 patch 6）并在 `Binding` / `BindP` / `BoundSession` 全链路透传；
`SessionBindingSchema.lastEpoch` 缺省 `null`。取消/失败路径与成功路径一样落游标（`finally`）。
扩展端目前仍只写 `lastSeq`，`lastEpoch` 等 R4 随扩展绑定层一起补。

> R1 是 R2 的前置：`runTurn` 需要 `sync` 的完整形状与审批结案事件。

## R2 · 单一 run 状态机（2–3 天）

按 [agent-run-state-machine.md](../../decisions/agent-run-state-machine.md)：

- 在 `@cogito/agent-runtime` 实现 `runTurn`；
- 修 race 丢帧、deadline 定时器、首帧前 yield 空快照；
- 显式 run 参数（mode / provider / cwd / mcp / systemText）；
- client 与 extension 改为消费 `runTurn`，删除各自的帧循环；
- 审批取消语义统一为「优先 `reject_once`」；
- 错误归因统一走 `annotateRunFailure`。

**验收**：fake transport 单测覆盖 sync 带审批、gap、epoch 变化、race、idle timeout、首帧 throw；
client 与 extension 同用例输出一致；`pnpm --filter @cogito/client exec vitest run src/features/agent src/views/agent` 全绿。

**落地**：`packages/agent-runtime/src/agentd/turn.ts` 提供 `runTurn`（发起一轮）与 `pumpTurn`（唯一事件泵，
恢复订阅复用它）：

- 不丢帧：未消费的 `frames.next()` / `queue.take()` promise **留住**，注入胜出后继续 await（F-008）；
- 超时进 race：空闲计时器是 race 的一路，半开连接也会按时收尾（F-009）；
- 首帧前不抛：client / extension 的端口在早退时先 `yield` 一条可见的 `error` 事件（F-011）；
- 显式参数：`mode` / `cwd` / `mcpServers` / `systemText` 全部由调用方给，状态机不读全局；
- 每轮显式 `provider/model` 在建会话**之前**落到 goose defaults（F-014：内联 / 子代理 / 目标首轮
  本轮就要新建会话，不先写 defaults 传参等于白传）；
- 归因统一：`agentd/run-error.ts` 上提到协议层，`TurnFailure` 的 `code` 区分
  `subscribe_failed` / `run_rejected` / `stream_closed` / `idle_timeout` / `run_failed`；
- `deriveOption` 只认精确 `*_once`，找不到就当「取消结案」（F-029：不再有 `/allow/` 正则兜底）。

**未做（转入 R4）**：F-013「模式两个真相」（后已定为快照优先）、扩展端 `lastEpoch` 落库与
`truncated` 后的正文重建（两项均已在 R4 结清，见 audit 0.6）。

## R3 · 收敛与删除（1–2 天）

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| 删 `packages/agent` 死循环 ✅ | 除 `provider.ts` 外的模块全部删除（`loop.ts` / `client/openai-compatible.ts` / `agent.ts` / `events.ts` / `message.ts` / `model.ts` / `permission.ts` / `skill.ts` / `tool.ts` / `index.ts`）；`package.json` 只导出 `./provider` | 全仓 grep 无引用；studio 侧 `@cogito/agent/provider` 仍可解析（单测 924 例通过） |
| 处理 `agent-protocol/protocol` ✅ | 零引用且与真实形状漂移 → **删除**；包只导出 `./policy` | 无「零引用」导出；`agent-protocol` type-check + 24 例通过 |
| 工具分类收敛 ✅ | 安全判定只有 policy；`tool-labels` 的写卡判定改名 `usesWriteCard`（消掉同名不同义）；新增 `tool-classification.test.ts` 对账（写卡 ⊆ 安全写、动文件 ⊆ 安全写、剥前缀同结论） | 同一批工具名在三处不再矛盾 |
| `open` / `fetch` 歧义动词 ✅（F-027） | 移出只读动词表，`open_pr` / `fetch_url` fail-closed 按写；已知只读联网工具进精确名单 | policy 单测覆盖新语义；client 对账用例同步 |
| 文档对齐 ✅ | `apps/agentd/README.md` 端点表补齐；`agent-orchestration.md`（空闲超时 / 模型切换 / 子代理 / 业务规则落点）；`plan-mode.md`；`agent-run-status.md` | 抽查与代码一致 |
| 基线失败 ✅ | 统一 `cogito_browser_open` 语义并同步 client 测试（R1 顺带修） | 614 例全绿 |

## R4 · 体验与剩余正确性（2–3 天）

| 编号 | 任务 | 验收 |
| --- | --- | --- |
| F-015 ✅ | `runThreadPrompt` 增加 `withTools?: boolean`；内联改写传 `false`（真的拿不到 MCP 工具，不靠提示词恳求） | 内联改写不出现审批卡 |
| F-016 ✅ | 后台目标轮续租（30s 一次，TTL 10min）；`goal-auto-advance` 用「发送后正文是否被清空」判定 `send()` 真的发出 | 后台 >10 分钟仍能推进 |
| F-017 ✅ | 计划执行状态机下移到 `features/agent/plan-execute-session.ts`：单飞占位、**发出去才置 running**、记住基线尾部；组件只做观察（失败回滚目标记录） | 「立即 done」竞态消失 |
| F-018 ✅ | orphan 补写改为「先落历史再清 running」（含强行让位分支）；单测锁住补写时标记仍在 | 完成后立刻刷新不丢回复 |
| F-020 ✅ | `compactThreadSession` 用 `hasThreadSession` + `record.run` 检查 | 刷新后可压缩；不抢占运行中轮 |
| F-021 ✅ | `AGENTD_NOT_READY` → `clearAcpHandle` + abort 本地轮 + `abortAllBackgroundTurns` + `clearRunState` | 侧栏不长期「生成中」 |
| F-024 ✅ | 删除 `thread.mcpServers.length < 0` 恒假条件 | 不再全量推送 thinking 配置 |
| F-026 ✅ | 服务端写者租约：`x-cogito-client` 标识 + `409 writer_lease_held`（带 `revision`/`holder`）+ 显式 `takeover`；10 分钟无收尾视为已死可接管 | 双客户端同时写时明确互斥 |
| F-029 ✅ | R2 已随 `deriveOption` 收紧一并修完 | 不产生永久放行 |
| F-030 ✅ | `readSse` 逐行解析：多行 `data:` 拼接、`\r\n\r\n` 边界、冒号后无空格、注释行 | 经代理仍可解析 |
| F-035/F-037/F-038 ✅ | `GET /threads/:id` 与 `/state` 如实报 `running`/`idle`、state 失败留痕；`db.ts` 迁移加事务 + 语句缓存；修正「不写聊天内容」的错误说法 | 长跑内存稳定；状态可查 |
| 扩展游标 ✅ | 扩展 `agentThread.lastEpoch` 落库并在订阅时带上（无索引变更，不用升 Dexie 版本） | 刷新后不重放旧 `settled` |
| 上下文估算 ✅ | 发送侧登记本轮实际 `systemText`（`features/agent/sent-system-text.ts`），composer footer 与右栏面板直接读它，不再自己推导；没发过才回退 | 估算误差可解释 |
| F-013 ✅ | 「模式两个真相」定为**快照优先**：`runThreadPrompt` 接 `agentMode`，goose 会话档与审批判定同源（`findRunGooseMode` / `decideApprovalForThread` / `isReadOnlySession` 都接可选模式）；`ThreadSession.agentMode` 让恢复订阅继续用当初那一轮 | 计划档里重跑执行模式的老消息不再被拒写；反向仍锁写 |
| `truncated` 正文重建 ✅ | **已修（R5-D3）**：`POST /threads/:id/replay` + `replay` 事件 + `ChatStreamEvent.replace`；服务端 5 例、协议 1 例、映射 3 例、适配器 3 例 | 缺段后正文/卡片能补回且不重复；409/502 不影响本轮 |
| `AGENTD_ALLOWED_ROOTS` ⚠️ | **决定不注入**：渲染进程持有 token，静态根表换不来安全边界，还会误拒 home / 运行期新增工作区；任务目录下拉只列工作区内目录，本就没有越界输入 | 环境变量保留为托管部署开关；真约束进 R5 |

## R5 · 加固（形状已定，见 [ADR](../decisions/agent-r5-hardening.md)）

- **不做**「给可见终端套沙箱」：那等于砍掉产品承诺（用户自己的可见终端），风险已由审批 + 硬禁 + MCP 白名单覆盖；
- `cwd` 约束若要做，只能在可信侧（Rust 独占 admin token + `PUT /admin/roots`），不在渲染进程声明的根表上做；
- 唯一真正值得做的一项：**goose 回放通道** ✅（`POST /threads/:id/replay` → `session/load` 重放 → `replay` 事件），
  修掉 `sync.truncated` 后正文丢段；前提已实测（`messageId` 稳定、工具结果也重放、粒度按消息聚合 →
  必须 `replace` 而不是 append），探针：`apps/agentd/scripts/probe-replay.ts`；
- 真沙箱的触发条件（headless shell / 放开任意 MCP / 远程执行）与落地要点见 ADR §3。

## 每阶段的通用门禁

```powershell
pnpm --filter @cogito/agentd unit
pnpm --filter @cogito/agent-runtime unit
pnpm --filter @cogito/client exec vitest run src/features/agent src/views/agent
pnpm --filter @cogito/client type-check
pnpm --filter @cogito/agentd type-check
pnpm --filter @cogito/extension unit
```

新增测试基线：

1. `apps/agentd` 的 fake goose supervisor harness（spawn error / EPIPE / exit / restart 并发）；
2. `agent-runtime` 的 fake transport（sync 带审批、gap、epoch、race、idle timeout、首帧 throw）；
3. `apps/agentd/scripts/probe-run.ts` 增加断言：无重复文本、无缺段、取消后不再产事件、审批只结案一次。

## 手工验收（每阶段结束至少跑一次）

1. 首轮取消；2. 审批中刷新；3. 双客户端审批；4. >2000 条事件后断线重连；
5. agentd 重启后继续看；6. 中途换工作区；7. 切模型；8. 内联改写；
9. kill goose；10. 同 thread 快速发两条。

## 非目标

- 云端多租户编排、duroxide 合并、跨机可靠执行；
- 把 goal 循环搬进 agentd（单独立项，不在修 bug 时顺手做）；
- 多 worktree 并行 agent；
- 模型评审审批（Assisted）——先保证确定性档位。

## 回滚

- R0 的配置面收敛若有兼容问题：保留「内部方法」实现，仅恢复只读查询接口；
- R1 的事件日志若写入成为瓶颈：按 ADR 的降级路径（内存 + `durable:false` 告警），不阻塞回合；
- R2 的 `runTurn` 采用「先让 client 接入、扩展后接」的顺序，扩展可暂时保留旧循环，但必须修掉
  `cancelled:true` 与游标落库两处，避免行为继续分裂。
