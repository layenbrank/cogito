# Plan: agent 视图缺陷修复（MCP 挂载 / 重生成 / 编辑态 / 审批 / CSP / 工具改名 / 计划解析）

## 结论 (TL;DR)

7 个独立问题，分 7 个阶段，每阶段可独立验证。**新增的最高优先级是 Phase 0**：日志证明「接回旧会话」时 `session/load` 传了空 `mcpServers`，于是该会话既没有 `cogito-mcp`（本地 35 个工具）也没有 `corex-mcp`（7 个工具）—— 这同时回答了「corex-daemon 还能调用吗」和「corex-mcp / cogito-mcp 为什么不显示」。

1. **内置 MCP 挂载（P0，新增）**：`resumeThreadSession` / `resumeThreadRun` 的 `session/load` 传 `mcpServers: []`，`mountsCogito` 还写死 `true`。
2. **重生成/编辑重发瞬间结束（P0）**：泵在 `session/prompt` 之前启动，上一轮迟到的 `stop`/`error` 被新一轮当成自己的终态。
3. **编辑态失焦取消（P0）**：`MessageEditComposer` 没有 focusout 处理。
4. **审批模式逻辑（P0/P1/P2 全量）**：全局 permission.yaml 被会话级档位全表覆写、未知工具 fail-open、10 个只读工具被判写、readonly 任务被 goal 抬成 auto、票据超时不摘表、历史审批卡一律「已拒绝」。
5. **资源访问（P1）**：`font-src` 缺 `blob:`、`img-src`/`media-src`/`connect-src` 缺 `http:`。**只放宽 CSP**。
6. **内部工具改名（新增）**：`app_*` → `cogito_*`（35 个名字，7 个 Rust 模块 + lock 表 + 提示词 + 前端 20+ 处），并保证不出现 `cogito__cogito_*`。
7. **计划解析告警（P2）**：`JSON_BLOCK` 把任意代码块送 `JSON.parse`；digest 选择器每次状态变化都整段解析。
8. **目标模式状态（P0，新增）**：`startGoalRun` / `resumeGoalRun` 在**发送前**就把记录置成 `running`，`GoalAutoAdvance` 立刻拿**上一轮**的 assistant 当本轮收尾，再因 composer 里我们刚写进去的续跑提示（`typing`）或最后一条是 user（`interjection`）判定 `paused` —— `used` 仍是 0，于是「对话在流式输出，footer 显示已暂停 · 0/6 轮」。
9. **工具调用契约（P0，新增）**：`app_terminal_read` 报「缺少 id 或 cwd」的直接原因是模型传了 `sessionId` + `lines`，而 schema 只认 `id` / `cwd` / `maxChars`；**根因是它根本没拿到 `inputSchema`** —— 接回的会话没挂 MCP（第 1 条），模型只能按提示词里的工具名臆造参数，所以是「每次都失败」而不是偶发。
10. **会话标识（P0，全局，新增）**：`threads.mainThreadId` 是**草稿 id**（`__LOCALID_…`），落库后不变；而偏好/档案写侧用它、ACP 执行侧用 `remoteId` → 新会话的审批档、模式、计划、目标全部对不上号，重启后档案「存在但读不到」。（全量审查的 A1，必须先修）

---

## 本轮核查的六个新结论

**① corex-daemon 还能调用吗 —— 能，但模型侧看不到它的工具**

- 进程：`apps/client/src-tauri/src/utils/sidecar.rs` 启动 + `utils/child_job.rs` 托管；IPC 在 `system/sidecar_command.rs`（`call` / `call_stream` / `sidecar:toRead`）；PDF、截图等仍走它。
- 工具面：`corex-mcp`（`status.mcpPath`，`system/sidecar_command.rs:277`）由 `session/new` 的 `mcpServers` 注入（`session.ts:360-385`），它自己连 daemon 的命名管道。
- **断点**：接回旧会话时 `mcpServers: []`（`session.ts:1026`、`session.ts:2085`），`corex-mcp` 与 `cogito-mcp` 都没挂上 → 模型没有任何 `corex_*` / `app_*` 工具。

**② corex-mcp / cogito-mcp 为什么不显示**

- 它们**不是 goose extension**，是 ACP `session/new.mcpServers` 注入的会话级 MCP；`settings → 扩展` 只读 `config/extensions/*`（`goose-extensions.ts`）+ `session/extensions/*`，两条都不会列出它们。
- 再加上「接回会话传空名单」，连 goose 的会话扩展列表里也没有。
- 日志佐证：`[acp/session] 已接回旧会话` → `local 工具名与基线不一致，缺少:  实际: ` → `缺少 app_terminal_run`（`实际` 为空 = 工具面为空）。

**③ 命名重复问题**
goose 会给工具名加 server 前缀（已实测形态：`cogito__app_terminal_run`、`mcp__cogito__app_workspace_write`、`corex__corex_action`）。
所以「工具名 `cogito_*` + server 名 `cogito`」= `cogito__cogito_*`。**必须二选一**：server 改名，或工具名去品牌前缀。用 Phase 0 打印的真实 `tools/list` 名字定案（判定规则见 Phase 6）。

**④ 目标模式：对话还在流式输出，footer 却显示「已暂停 · 0/6 轮」**

- 显示层：`views/agent/chat/components/composer-footer.tsx::GoalTurnControl`。`run = useGoalRun(threadID)` 为 null（`readGoalRun` 对 `paused` / `done` / `interrupted` 一律返回 null，`goal-run.ts:150-156`）→ 走 `record.status !== 'running'` 分支；`paused` 映射成「已暂停 · 0/6 轮」。`used = 0` 说明这一轮**一次都没推进过**。
- 写入层：`paused` 只由 `finishGoalRun(id, 'paused')` 写（`goal-run.ts:458-476`），入口是 `advanceGoal(id, reason)`（`goal-run.ts:246-264`）里 `reason !== 'continue' | 'done'` 的四个分支，全部来自 `goal-auto-advance.tsx`：`aborted` / `interjection` / `typing` / `plan-stale`。
- **触发时序（根因）**：`aside.tsx::startImplement('goal')` 与 `composer-footer.tsx` 的「继续」都是**先** `startGoalRun` / `resumeGoalRun`、**后** `composer.setText(...)` + `send()`。记录由 null 变 `running` 会触发 `GoalAutoAdvance` 的 `useEffect`（依赖里有 `goal`），此刻 thread 还没进入 running：
  - `tailDigest` 取到的是**上一轮**已完成的 assistant 正文（`findGoalTailDigest` 只在 `isRunning` 时返回空串）；
  - `goal.used > 0` 为假 → 跳过「本轮归属」校验；
  - `isUserInterjection(messages)` 只看「最后一条是不是 user」；`typing` 只看 composer 是否非空 —— 而我们自己刚把续跑提示写进了 composer；
  - → `advanceGoal('interjection' | 'typing')` → 租约还活着、`status === 'running'` → **写 paused**（`used` 仍是 0）。
- **为什么看起来「粘住」**：一旦落成 `paused`，`readGoalRun` 立刻返回 null → `port/model.ts:404` 不再 `beginGoalTurn`、`goal-continue.ts` 不再续跑；而点「继续」又走同一条「先 resume 再 send」的路径，**同一个竞态可以再触发一次**，表现为「点了继续还是已暂停」。
- 并发证据：`renewGoalTurn`（`goal-run.ts:201`）在整个仓库**零调用方**，`TURN_LEASE_MS` 只有 10 分钟；任何 `hydrate()`（切线程 / 启动 / 保存计划）都会让 `recoverInterruptedGoals` 把超过 10 分钟的 running 行打成 `interrupted`，而 footer 的 `else` 分支把 `interrupted` 显示成「已用尽」且 `canResume` 不含它 —— 那条路用户**没有**继续入口。

**⑤ 工具调用为什么「总是失败」：`app_terminal_read` 缺少 id 或 cwd**

实际请求（模型发出的）：`tools.call("cogito__app_terminal_read", { sessionId: "agent:C:\\Users\\...\\knowledgebase", lines: 120 })`

- **参数契约对不上**：`terminal.rs:44-58` 的 schema 只有 `id` / `cwd` / `maxChars`。模型传的 `sessionId` 是 ACP 概念（会话 id 形如 `agent:<cwd>`，值其实**是对的**），`lines` 是 `tail -n` 直觉（对应 `maxChars`）。两个 key 都是 schema 里不存在的 → 必然报 `缺少 id 或 cwd`（`bridge/app_tools.rs:233`）。
- **根因链**：它用错了 key **并且**自己拼了 server 前缀 `cogito__` —— 说明它**没看过 `tools/list` 里的 inputSchema**，只是照着系统提示词里的名字猜。这与第 1 条（接回会话 `mcpServers: []`）是同一根源：工具面没挂上，模型只有名字、没有契约。提示词（`prompts.ts:115-118`）确实只写了“用 `app_terminal_read` 续读”，没写参数。
- **错误不可自愈**：`"缺少 id 或 cwd"` 既不说是哪个 key 错了，也不给候选值 —— 模型下一轮只能换个猜法，于是看到成片的重复失败。对比 `device` 分支已有的好写法：`format!("没有这个预设：{preset}（可用：{}）", …)`（`app_tools.rs`）。
- **隐藏参数 `scope`**：`app_terminal_run`（`app_tools.rs:225`）与 `terminal_read`（`:234`）都接受 `scope`（同 cwd 多线程隔离成 `agent:<cwd>#<thread>`），但 **schema 里没有**。一旦真的带了 scope，模型用 `cwd` 派生出的无 scope id 就永远读不到那个 tab。
- **省略 id 时没有回落**：桥已经从 `x-cogito-session` 拿到发起方会话（`bridge/http.rs:337` → `app_tools::call(..., session)`），但 `terminal_read` / `terminal_write` **没接这个参数**（`app_tools.rs:58-70` 里只有 `agents_catalog::SPAWN` 用了 `session`）。所以“读我刚跑的那个终端”必须先去 `app_terminal_list` 搎 id，多一步就多一次失败机会。
- **外层沙箱的放大器**：`{"code":"async function run() { … tools.call(…) }"}` 这个形状不是本仓的工具（`crates/` 下无此 schema），是用户接入的第三方 JS 沙箱 MCP；它把调用原样转发、不剥前缀也不修正参数，并且调用方自己写了 `.slice(-4000)` —— `TerminalRun` 虽然返回 `id`（`utils/terminal.rs:221-229`），一旦输出长就被截掉，模型更拿不到 id。

**⑥ 会话标识：写侧用草稿 id、读侧用库 id（全局根因）**

详见下方全量审查的 **A1**。一句话：`mainThreadId = __LOCALID_…` 只能是**渲染期**的临时标识，任何落库/跨进程的键（审批档、模式、计划、目标、草稿工作区）都必须折成 `remoteId`；否则新会话的一切设置都在「写进了一个永远没人读的键」上。

---

## Steps

### Phase 0 — 内置 MCP 挂载与可见性（P0，阻塞 Phase 6 命名决策）

> **实施说明（2026-11-13）**：1–4 已完成。落地口径：
>
> - `findSessionMcpServers` / `findThreadAcpSessionID` / `readBuiltinMcpSwitches` 从 `session.ts` 导出，
>   新增 `features/agent/acp/session-mcp.ts` 收口「会话级 MCP 状态」（`findSessionMcpStatus` +
>   `readSessionToolSurface`），扩展页与诊断页共用一份。
> - 扩展页新增只读「内置服务器」段：`local` / `corex` 各一行，显示**已接入本会话 / 未接入 / 已关闭**、
>   工具数与启动命令，无删除/停用按钮。三种「未接入」分开说（自己关掉的 / 挂上了但没读到工具 / 本会话没注入）。
> - 诊断页新增「本会话工具面」：内置 server 的接入情况 + `tools/list` **原始**名字（可折叠）。
> - 第 1 条第三点（`session/load` 被拒 `mcpServers` 时降级为空名单）**未按字面实现**：现在是
>   `console.warn` + 返回 null，由调用方开新会话（工具会重新挂上）。按字面降级会恢复上下文但**丢掉全部工具**，
>   正是本次要修的形态，所以不采信；真遇到参数被拒再按错误文案单独处理。

1. `apps/client/src/features/agent/acp/session.ts`
   - `resumeThreadSession`（≈1026）与 `resumeThreadRun`（≈2085）：`mcpServers: []` 改成与 `openThreadSession` 同一份名单（抽 `findSessionMcpServers(threadID)`，`session/new` 与 `session/load` 共用，避免再次漂移）。
   - `ThreadSession.mountsCogito` 按实际注入结果计算（`servers.some(s => s.name === 'cogito')`），不再在 resume 分支写死 `true`。
   - `session/load` 若被 goose 拒绝 `mcpServers` 参数（错误消息提到 params/mcpServers）：降级为「空名单 + 明确 console.error」，不静默。
2. `verifyToolSurface`：`names.length === 0` 时单独打 `[acp/session] 工具面为空：本会话没有挂任何 MCP`；非空时打印**原始**名字（Phase 6 要靠它看前缀规则）。
3. `apps/client/src/views/agent/settings/sections/extensions.tsx`
   - 在「自定义服务器」之上加「内置服务器」只读卡：`cogito`（本地工具面）/ `corex`（corex 工具面），显示「是否已挂到当前会话 / 工具数 / 命令路径」，不给删除按钮。
   - 数据来源：`features/agent/acp/session-mcp.ts`（新增）`findSessionMcpStatus(threadID)` → `{name, command, isMounted, toolCount}`。
4. `apps/client/src/views/agent/settings/sections/diagnostics.tsx`
   - 加「本会话工具面」区块：MCP 名 / 命令 / `tools/list` 原始名字（可折叠）。这是「为什么不显示」今后的自查入口。

### Phase 1 — ACP 轮次关联（修「瞬间结束」）

> **实施说明**：5–7 已完成。`LoadedQueue.reset()` 清 `items` + `error`（不动 waiters），`prompt()` 复用它；
> 迟到终态的判定落在 `runThreadPrompt` 的 `deliveredTerminal` 上（每轮一个标记，不用
> 模块级 `Map<acpSessionID, …>`：一轮一个闭包就够了），命中「已交付 / 属于上一轮」的终态直接丢弃并继续泵；
> 空文本分支改为可见 `error`，不再静默成功。

5. `apps/client/src/features/agent/acp/loaded-session.ts`：`LoadedQueue` 加 `reset()`（清 `items` + `error`，不动 waiters），`prompt()` 改用它。
6. `apps/client/src/features/agent/acp/session.ts` `runThreadPrompt`
   - 模块级 `Map<acpSessionID, {expected, delivered}>`：`prompt()` 前 `expected += 1`；泵交付 `stop` 时若 `delivered >= expected` → **上一轮迟到终态，丢弃并继续循环**；`pump.catch` / `promptDone.catch` 里自己合成终态时也要 `delivered += 1`。
   - 顺序：先 `const promptDone = thread.session.prompt(...)`，**再**启动泵。
7. `apps/client/src/features/agent/port/model.ts`：空文本分支由 `finish` 改成可见 `error`，不做静默成功。

### Phase 2 — 编辑态失焦取消 _可与 Phase 1 并行_

> **实施说明**：8 已完成。取消挂在编辑壳 `ComposerPrimitive.Root` 的 `onBlur` 上，
> `relatedTarget` 仍在壳内（点「取消 / 更新」）时不动，其余情况 `aui.composer.cancel()`；
> Esc 的 `cancelOnEscape` 保留。

8. `packages/design/src/assistant/edit-message.aui.tsx` `MessageEditComposer`
   - 编辑壳上挂 `onBlur`（focusout 冒泡）：`relatedTarget` 不在壳内 → `composer.cancel()`（`useAui().composer.cancel()`；作用域不成立时用隐藏的 `ComposerPrimitive.Cancel` 触发器兜底）。
   - 点「取消 / 更新」时 `relatedTarget` 在壳内 → 不触发；Esc 保留 `cancelOnEscape`。

### Phase 3 — 审批模式逻辑（全量）

> **实施说明（2026-11-13）**：9 / 10 / 11 / 13 / 14 与 12 的输入区开关已完成（`approval.test.ts` 18 条通过）。两点落地口径：
>
> - 档位不再写进 `permission.yaml`（只写硬禁用名单），`readonly` 改由 `requestThreadPermission` 在会话层显式拒绝写工具；**残余风险**：若 goose 的 `smart_approve` 对个别写工具不问就放行，只读会漏 —— 需按 Further Considerations 1 实测 `chat` 模式后收口。
> - 设置页的 `activeSessionID` 旁路已修（2026-11-15）：那三节 + 用量页都是 chat 的**兄弟路由**，
>   不在 `AssistantRuntimeProvider` 里拿不到 `useAuiState`，所以做法是让 `AgentModeThreadSync`
>   在切换主线程时把**库内 id** 写回 `agent` store（`toSyncActiveSession`，只改指针不读消息）；
>   以前这个指针只在启动取首项、命令面板打开会话时更新，侧栏切会话后设置页一直指着别的会话。

9. **工具效果真源（P0-3 / P1-5）** `features/agent/approval.ts`：兜底改 **fail-closed（未知按写）**；读动词去掉 `get`/`list`/`action`/`info` 这类子串（命中 `budget`/`target`/`widget`/`transaction`），改按 `_` 分段匹配；优先用 Rust 目录的 `effect`（`/internal/tools/list` 已带，`tool-risk.ts` 已在用）作权威表；修掉 10 个被误判为写的只读工具（`browser_open|wait|screenshot|network`、`agent_wait|result`、`code_symbols|outline|refs|impact`）。
10. **会话级 vs 全局（P0-1 / P1-11）** `acp/sync-approval-mode.ts`：会话 `mode` 为唯一真源；`permission.yaml` 只写硬禁用名单一次，不再按档位全表覆写；同步失败 fail-closed 并提示。
11. **目标 / 任务（P0-2 / P1-9 / P1-10）**：`ensureGoalApproval` 只允许 `ask → auto`（`readonly` 不抬级）；`requestThreadPermission` 的 goal 自动放行加「有效档 === auto」；`automation/runner.ts` 用运行期 override，不写也不清绑定会话的 `approvalByThread`。
12. **UI 一致性（P1-4 / P1-8）**：`approval-switch.tsx` 用 `readScopeThread()`、显示有效档、计划模式置灰并解释；设置页去掉 `activeSessionID` 旁路。
13. **票据与历史（P1-6 / P1-7 / P2-13）**：超时摘表 + `settled` 标记；`isStale` 只在 `approved === undefined` 时生效；`settledApprovals` 键加 threadID。
14. **其余 P2**：库值 `isApprovalMode` 校验；子 agent 继承父会话有效档；本地工具判定改用成员表（Phase 6 一并做）；`never_allow` 拒绝在工具卡可见；删未用的 `GooseMode: 'chat'`（若第 10 步采用 chat 则保留）。

### Phase 4 — 资源访问（只放宽 CSP） _可与其它阶段并行_

> **实施说明**：15–16 已完成。`app.security.csp` 里 `img-src` / `connect-src` 加 `http:`、
> `font-src` 加 `blob:`、`media-src` 加 `http:` 与 `https://asset.localhost`；`devCsp` /
> `assetProtocol.scope` / `capabilities` 未动。预览处注释已改成「走 `asset:` 协议 + 作用域」的说法。

15. `apps/client/src-tauri/tauri.conf.json` → `app.security.csp`：`img-src` += `http:`；`font-src` += `blob:`；`media-src` += `http:` 与 `https://asset.localhost`；`connect-src` += `http:`。不动 `devCsp` / `assetProtocol.scope` / `capabilities`。
16. `views/agent/chat/components/aside-files-preview.tsx:307` 过期注释改为三源授权说明。picsum 保持回落内置占位图。

### Phase 5 — 计划解析告警

> **实施说明**：17–18 已完成。`JSON_BLOCK` 只认 ````json` 代码块，payload 不以 `{` / `[` 开头直接跳过且不 `warn`；
> `aside-plan` 的 `draftDigest` 换成「最后一条 assistant 文本长度 + 尾部字符」指纹，只有变化才全量解析。

17. `features/agent/plan-draft.ts`：`JSON_BLOCK` 只认 ` ```json ` 代码块、payload 需以 `{`/`[` 开头，失败不 warn，结果按文本 `WeakMap` 缓存。
18. `views/agent/chat/components/aside-plan.tsx`：`draftDigest` 选择器改轻量指纹（最后一条 assistant 文本长度 + 尾部字符），只有变化才全量解析；同法检查 `aside-busy.tsx` 的 `PlanDraftBlock`。

### Phase 6 — 内部工具改名 `app_*` → `cogito_*` _depends on Phase 0_

> **实施说明（2026-11-13）**：19–25 已完成。定案取第一条分支 —— server 注册名 `cogito` → `local`，
> 工具名保留 `cogito_` 前缀，全名形如 `local__cogito_workspace_read`（品牌只出现一次）。
> 35 个 Rust `pub const` + `cogito_ping`（原 `app_ping`）改名；`agent-tools.lock.json`、`tool-labels.ts`、
> 提示词、单测、`docs/` 与 `.cursor/skills/knowledge-wiki` 同步。
> `agent-tools.ts` 的归属判定改为「`<server>__` 前缀 → 成员表 → 品牌前缀」，`matchesTool` 保留词边界后缀兜底
> （goose 还存在 `mcp_corex-mcp_corex_actions` 这种单下划线拼接形态）。**Rust 侧未编译验证**，待 `cargo check`。
> 顺带修掉 Phase 8 留在 `prompts.ts` 的语法错误（`TERMINAL_PLAYBOOK` 里未转义的反引号）。

**命名定案规则**（回应「不要 cogito_cogito_*」）：先看 Phase 0 打印的真实 `tools/list` 名字——

- 若出现 `cogito__app_terminal_run` 这类 `<server>__` 前缀 → **把 server 注册名从 `cogito` 改为 `local`**（`local__cogito_workspace_read`），工具名保留 `cogito_` 前缀；
- 若 goose 不额外加前缀 → server 名保持 `cogito`，工具名 `cogito_*`。
  两种结果都只出现一次品牌名。

**改名映射（35 → 35，`app_` → `cogito_`）**

| 域       | 新名字                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工作区   | `cogito_workspace_list` / `_read` / `_write` / `_patch`                                                                                                           |
| 知识库   | `cogito_knowledge_list_bases` / `_list_docs` / `_read_doc` / `_read_wiki` / `_search` / `_lint` / `_ingest` / `_write_doc` / `_graph_search` / `_workspace_write` |
| 代码     | `cogito_code_symbols` / `_outline` / `_refs` / `_impact` / `_search`                                                                                              |
| 浏览器   | `cogito_browser_open` / `_read` / `_act` / `_wait` / `_screenshot` / `_network` / `_intercept` / `_device`                                                        |
| 终端     | `cogito_terminal_run` / `_read` / `_write` / `_list`                                                                                                              |
| 子 agent | `cogito_agent_spawn` / `_wait` / `_result`                                                                                                                        |
| 日程     | `cogito_calendar_read`                                                                                                                                            |

19. **Rust 侧**（名字都是 const，改一处）`apps/client/src-tauri/crates/core/src/tools/{calendar,workspace,knowledge,code,browser,terminal,agents}.rs` 的 `pub const`；`tools/mod.rs` 的 `write_tools` / `guarded_tools` 用 const 引用（自动跟随），只改测试里的字符串断言；`crates/mcp` 若有硬编码名字一并改。
20. **前端识别去前缀**：`features/agent/approval.ts` 的 `toolBaseName` 扩成 `stripServerPrefix`（同时剥 `mcp__<server>__` 与 `<server>__`），`isLocalAppTool` → `isLocalTool`（用 `agent-tools.lock.json` 的 `local` 成员表判定，不再靠 `app_` 子串）；`agent-tools.ts::findServerOf` 同样改为「剥前缀后查成员表」。
21. **lock 与标签**：`features/agent/agent-tools.lock.json` 的 `local` 数组；`features/agent/tool-labels.ts`（35 条键）。
22. **提示词**：`features/agent/model/prompts.ts` 里 33 处工具名 + `SAFETY_RULES` 的「`app_*` / `corex_*`」措辞改「`cogito_*` / `corex_*`」。
23. **按名字分派的前端**：`parse-tool-result.ts`、`tool-card*.tsx`、`write-review*`、`aside-*.tsx`、`open-aside-*.ts`、`delegate-surface.tsx`、`aside-files-preview` 等，一律走 `stripServerPrefix` 后再匹配（不许再出现字面 `app_`）。
24. **测试**：`approval.test.ts`、`tool-risk.test.ts`、`parse-tool-result.test.ts`、`agent-tools.test.ts`、`write-review.test.ts`、`prompts.test.ts`。
25. **文档**：`docs/decisions/security-boundary.md`、`docs/apps/client/agent-terminal.md` 及其它提到 `app_*` 的地方。不做旧名兼容（不保留 `app_*` 别名），避免双轨。

### Phase 7 — 目标模式状态机（修「对话在跑却已暂停」）

> **实施说明（2026-11-13）**：26 的 `turnStartMessageID` 落库方案改为**不加列** —— 直接用已有的 `expectedPrompt` 做本轮归属基线（`findTurnStartIndex`：消息里必须能找到「我们发的那条提示」，且它之后出现了 assistant），效果等价且免迁移。26–32 已实现，`goal-run.test.ts` 30 条通过。

26. **收尾判定绑定「本轮」**（P0，直接对应症状）`views/agent/chat/components/goal-auto-advance.tsx` + `features/agent/goal-run.ts` + `features/agent/plan-store.ts`
    - `GoalRecord` 增加 `turnStartMessageID`（落 `agent_goal`，随 `hydrate` 恢复）：`startGoalRun` / `resumeGoalRun` / `advanceGoal` 派发续跑时写入「当前最后一条消息 id」作为基线。
    - `GoalAutoAdvance` 只在同时满足时判定收尾：① `messages.at(-1)?.role === 'assistant'`；② 该 assistant 的 `id !== turnStartMessageID`；③ 它之后没有新的 user 消息。三条任一不满足 → 直接 return，**不消费租约、不写 paused**。
    - `handled` 指纹改用该 assistant 的 `id`，不再用「最后一条 assistant 的全文」。
    - 这样 `goal` 由 null 变 running 时的那次 effect 会被 ② 挡掉（上一轮 assistant 的 id 就是基线）。
27. **`typing` 分支豁免我们自己的提示**：`composer.getState().text` 归一化后等于 `readGoalPrompt(threadID)` 时不算「用户在输入」（当前会把刚 `setText` 的续跑指令当成用户打字）。
28. **`isAbortedRun` 区分 cancelled / error**（`goal-run.ts:649`）：现在 `status.type === 'incomplete'` 一网打尽，`cancelled`（用户停止，该暂停）与 `error`（网络/模型失败，应提示并允许重试）被同等对待；`incomplete + reason 'error'` 不再静默暂停，改为 toast + 保留可继续。
29. **租约续期**（`goal-run.ts:201` 的 `renewGoalTurn` 目前零调用方）：在 `runThreadPrompt` 的流式循环里按节拍续租（如每 30s 一次，`finally` 清理），或由 `port/model.ts` 起定时器续；同时 `recoverInterruptedGoals` 跳过「本进程内该 thread 有活跃 run / background turn」的行，避免 10 分钟以上的长任务被 `hydrate()` 打成 `interrupted`。
30. **footer 四态**（`composer-footer.tsx:244-300`）：`else` 现在把 `interrupted` 显示成「已用尽」且 `canResume` 不含它 → 目标一旦自愈成 `interrupted` 就没有继续入口。补「已中断」态，并把 `interrupted` 纳入 `canResume`。
31. **防重复派发**：`aside.tsx::startImplement('goal')` 在发送前就 `startGoalRun`（`used = 0` + 租约），此时若 `GoalAutoAdvance` 判定 `continue` 会**再发一轮**（预算跳号 / 双发）。由 26 的基线校验兜住；另加「`used === 0` 且本会话还没有目标轮的 assistant 消息时不自动派发」。
32. **单测**：`goal-auto-advance` 时序（记录置 running 时不触发收尾）、`typing` 豁免自己的 prompt、`interrupted` 可继续、`renewGoalTurn` 续租后不被 `hydrate` 打回、`advanceGoal` 在 `turnStartMessageID` 未前进时返回 `ignored`。

### Phase 8 — 工具调用契约可自愈（修「总是执行失败」）

> **实施说明（2026-11-13）**：33–38 已完成。回落链为「显式 `id` → `cwd` 派生 → 本会话最近一次 `app_terminal_run` 的 id → 带候选的报错」；`bridge/app_tools.rs` 加了 `pick_arg` / `last_terminals` / `decorate_terminal_output` 与 3 条 Rust 单测。Rust 侧已验证：`cargo check --all-targets` 与 `cargo test -p cogito-command -p cogito-core` 全绿。

33. **参数别名归一**（P0）`apps/client/src-tauri/src/bridge/app_tools.rs` + `crates/core/src/tools/terminal.rs`
    - `text_arg` 加一层 `pick_arg(arguments, ["id", "sessionId", "session_id", "session"])`；`terminal_write` 同理。`maxChars` 接受 `lines` 作为别名（按行→字符估算，或直接取行数×200，并在返回里回显实际生效的参数）。
    - schema 描述里把「参数名是 `id`，不是 `sessionId`」写清楚；`app_terminal_run` / `app_terminal_read` / `app_terminal_write` 都把 `scope` 补进 `properties`（当前是隐藏参数）。
34. **错误必须可自愈**：`缺少 id 或 cwd` 改成带候选 + 下一步，例如
    `没有指定终端：请传 { id } 或 { cwd }；当前打开的终端：agent:C:\\…\\knowledgebase、agent:C:\\…\\kb#thread-1（由 app_terminal_list 可得）`。并统一约定：所有工具 `Err(String)` 至少包含「错在哪个参数 + 可选值 + 正确调用示例」三者之一。
35. **省略 id 时回落本会话**：把 `session: Option<&str>` 继续传给 `terminal_read` / `terminal_write`（现在只有 `agents_catalog::SPAWN` 用了它，`app_tools.rs:58-70`）：
    - 优先「本桥会话最近一次 `app_terminal_run` 的 id」（在 `TerminalHub` 或本会话映射里记一份）；
    - 否则用本会话 cwd 派生的 `agent:<cwd>`（需桥侧知道该会话 cwd —— 可从 ACP 会话登记补进来）；
    - 都没有才报错（错误按第 34 条带候选）。
    - `scope` 也改成默认取会话 id，不再让模型猜。
36. **让 id 不会被截断**：`app_terminal_run` / `app_terminal_read` 的返回在 `output` **首行**额外带一条 `[terminal id=<id> cwd=<cwd> isRunning=<bool>]`，即使调用方 `slice(-N)` 或模型只读输出也能拿到 id。
37. **提示词改「带参数的最小用法」**（`features/agent/model/prompts.ts:115-118`）：把 `app_terminal_read({ id })` / `({ cwd })`、`app_terminal_list()` → `id` 这条链写全，并说明「省略 id 时默认读本会话终端」。
38. **单测**：`sessionId`/`lines` 别名、错误文案包含候选 id、省略 id 回落本会话、`scope` 默认值、run 返回首行带 id。

---

## 全量审查：`views/agent`（四路并行，2026-11-13）

> 与前面阶段的关系：**A1 是全局根因**。不改它，Phase 3（审批）与 Phase 7（目标）在「新会话」场景下修的仍然是错的那把键。

### A1（P0，全局）会话标识两套 id 混用：新会话的模式/审批/计划/目标全落在草稿 id 上

- **现象**：新会话里选「自动审批」或「计划」，首轮下发不生效（goose 拿到的仍是全局默认）；会话的计划/目标档案写成 `sessionID = __LOCALID_…`，重启后 `readPlan(remoteId)` 恒为 null —— 行还在库里，但永远匹配不上（计划卡、目标轮次卡、`PlanAutoOpen` 全失效）。
- **根因**：`threads.mainThreadId` 在本进程内是 assistant-ui 的**草稿槽 id**（`__LOCALID_…`），落库后**不会**变成库内 id；ACP / 审批执行侧一律用 `remoteId`。写侧（UI / 偏好 / 档案）用草稿 id，读侧（`findEffectiveApprovalMode` / `findThreadAcpSessionID` / `sessionByThread`）用库 id。
- **证据**：`apps/client/src/views/agent/chat/runtime.tsx:302-310`（`AgentModeThreadSync` 直接传 `mainThreadId`）→ `features/agent/approval.ts:64-70,138-140`（`readScopeThread()` 即草稿 id）→ `chat/components/plan-recorder.tsx:20-23,50`（`savePlan({ sessionID: threadID })`）；执行侧 `features/agent/acp/session.ts:979,1092` 用的是 `identity.ensure()` = `remoteId`。核心库确认 `initialMainId` 就是新播草稿：`@assistant-ui/core/.../RemoteThreadList.ts:601-609,658`，晋升为正式会话时**保留**草稿 id（`remote-thread-state.ts:506-545`）。仓库自己也有旁证：`chat/components/use-session-thread-id.ts:1-13`、`use-sidebar-branches.ts:143-158`、`composer-queue.tsx:160-167`（专门折成 `item.remoteId`）。
- **修法**：抽一个 `resolveSessionID()` = `threadListItem.remoteId ?? null`，`AgentModeThreadSync`、`plan-recorder`、`AsidePlan`、`goal-*`、`approval-switch`、`composer-queue` 全部改用它；对已落的 `__LOCALID_%` 行做一次迁移（`agent_plan` / `agent_goal` / `agent.json.approvalByThread` / `modeByThread`）。
- **注意**：`aside.tsx:178` 的 `panelKey = mainThreadId + rootPath` 目前在「晋升后 id 不变」的前提下是稳定的；改成 remoteId 后会在首次落库时变化一次 → 那次要避免整树重挂（用 `threadListItem.id` 这类稳定键，或只在切换会话时变）。

### P0 清单

| #   | 位置                                                                                                     | 问题                                                                                                                                                                                        | 证据                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `chat/runtime.tsx:302-310` 等                                                                            | 草稿 id / 库 id 混用（见上）                                                                                                                                                                | 同上                                                                                                                                             |
| A2  | `chat/components/use-aside-files-editor.ts:281-304`、`aside-files-preview.tsx:158`                       | 磁盘被外部改动后仍写回旧缓冲区：`revision` 重读磁盘，但 `findOrCreateModel` 不 force → 拿到旧 model，同时把 `savedValueRef` 改成新内容（旧缓冲区立刻「变脏」）；按保存就把 agent 的修改回滚 | `monaco-models.ts:30`「默认不覆盖缓冲区」；触发源 `tool-card-read-write.tsx:202,235`、`workspace/git.ts:184,202`                                 |
| A3  | `src-tauri/crates/command/src/agentTurn.rs:52,180-240`                                                   | 冷恢复/后台补写时 `tool-result.output` 与 `tool-call.input` 被硬截到 8192 字符，截在 JSON 中间；数组超 cap 直接 `break`（`paths` 后半静默丢项），且这份截断还会落库                         | 消费方 `acp/background-turn.ts:602-625,635-649`、`port/thread-history.ts:178-215`；另有 `MAX_BYTES=8MiB` 从头丢整条事件（`agentTurn.rs:94-118`） |
| A4  | `packages/chat/src/adapters/chat-model.ts:63-71,557-590`                                                 | 用户停止/流中断后，in-flight 工具 part 永远停在 `running`（`toToolStatus` 没有 cancelled 分支），并随消息落库                                                                               | 渲染侧 `tool-card-terminal-body.tsx:96,165-172`、`tool-card-job.tsx:52`；右栏已有正确口径可复用：`features/agent/running-commands.ts:43-60`      |
| A5  | `chat/chat.tsx:283-293`、`components/sidebar.tsx:96-107`、`features/agent/port/draft-workspace.ts:20-31` | 新会话归属：只有侧栏「+」写草稿槽，命令层（`Ctrl+N`）不写；落库时回落「当下」的 `activeWorkspaceID`，且草稿槽没有放弃/切会话时清空的路径 → 挂到错误工作区                                   | `port/history.ts:70-76`（落库时才读指针）                                                                                                        |
| A6  | `tasks/model.ts:381-404`、`features/automation/cloud.ts:60-79`                                           | 编辑云端任务静默改写执行身份：`TaskDraft` 不含 `runAsKind`，保存时缺省成 `'user'`（租户身份丢失），表单里也没这个字段                                                                       | Rust 同源：`crates/core/src/automation/service.rs:266-268,379`（更新时强制覆盖）                                                                 |

### P1 清单

| #   | 位置                                                                                                                                                                       | 问题                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `chat/runtime.tsx:246-266`                                                                                                                                                 | `RestoreRunningThread` 是死代码：判据是「`mainThreadId` 为空」，但挂载即播草稿主线程 → 首帧必命中早退；刷新后永远回不到在跑的会话                                                                           |
| B2  | `packages/design/src/assistant/composer-input.aui.tsx:743`                                                                                                                 | `submitMode='enter'` 时 `Ctrl+Enter` 直接 `return`（无 preventDefault）→「立即转向」不可达，只往草稿塞一个换行；文案仍承诺 `labels.ts:53,67`                                                                |
| B3  | `chat/components/composer-queue.tsx:170-182,209-219`                                                                                                                       | 刷新回灌时 `isRunning` 只同步读一次（resume 尚未置位）→ 排队消息被立刻补发，抢在接回的后台回合前面                                                                                                          |
| B4  | `chat/runtime.tsx:277-292`                                                                                                                                                 | `FocusAutomationSession` 在「已停留在目标会话」时是空操作：`threads.reload()` 只刷列表，`switchToThread(same)` 直接早退 → 自动化起泵后接不上流                                                              |
| B5  | `packages/chat/src/adapters/chat-model.ts:496-499`                                                                                                                         | 审批通过但工具失败时，用 `isError` 反推 `approved=false` → 收据显示「已拒绝」；`parse-tool-result.ts:938-943` 也因此吞掉错误态                                                                              |
| B6  | `chat/components/tool-card-terminal-body.tsx:96,165-172`、`tool-card-job.tsx:52`、`tool-card-retrieval.tsx:31`、`tool-card-web-search.tsx:35`、`tool-card-timeline.tsx:97` | 只有 `status.type === 'running'` 才算「进行中」，其余一律画成功 → 等审批（`requires-action`）、被取消（`incomplete`）都显示绿勾「执行完成」                                                                 |
| B7  | `chat/components/tool-card-job.tsx:52`、`tool-output.ts:200-206`                                                                                                           | `app_terminal_run` 超时返回 `isRunning: true` 时卡片仍画成功收据、进度条拉满（`result.isRunning` 没人读）                                                                                                   |
| B8  | `chat/components/tool-card.tsx:58-67`                                                                                                                                      | memo 比较器比 `status`/`approval` 的**引用**，适配器每个快照都新建字面量 → 永不命中，每 32ms 让所有工具卡重渲染；`tool-card-retrieval.tsx:38`、`tool-card-web-search.tsx:39` 的 `JSON.parse` 也没 `useMemo` |
| B9  | `chat/components/write-review.ts:207-224`                                                                                                                                  | 丢弃段还原用 `String.replace(bare)`：重复片段会还原到**第一处**；`oldText` 含 `$&`/`$1` 会被替换模式改写。前置校验 `tool-card-read-write.tsx:160-168` 同样只做 `includes`                                   |
| B10 | `chat/components/aside.tsx:447-453`、`:372,380`                                                                                                                            | 终端订阅的 effect 依赖 `[]`（还关了 lint），处理器吃住首帧 `rootPath = null` 的闭包 → 「去看输出」永远提示「先添加工作区」                                                                                  |
| B11 | `chat/components/aside.tsx:459,573`、`aside-context.tsx:93`                                                                                                                | 「查看详情」只在 `mode==='home'` 才挂 `AsideBusy`；事件与切页签同 tick 派发，卡片尚未挂载 → 事件丢失（上下文卡不展开、不滚动）                                                                              |
| B12 | `chat/components/session-search.tsx:105` vs `:219`                                                                                                                         | 会话搜索只 `title.includes()`，placeholder 却写「搜索会话标题或会话内容」                                                                                                                                   |
| B13 | `chat/components/workspace-form.tsx:88,99`、`workspace-form-save.ts:74`                                                                                                    | 编辑工作区：`draftFolders` 只在 `useState` 初始化读一次，异步 `toReadWorkspaceFolders` 回来后不回填；直接保存会用空数组全量替换 → 该工作区所有文件夹绑定被删                                                |
| B14 | `chat/components/aside-diff-data.ts:96-125`                                                                                                                                | `onMoreHunks` 无请求身份/取消标记 → 切文件后旧页被 `concat` 进新文件的 hunks，计数也变旧值                                                                                                                  |
| B15 | `settings/sections/use-model-inventory.ts:139-166,180-235`                                                                                                                 | provider 弹框：`activeId` 先切、`formValues` 后到，中间可点保存 → 把上一个接入的字段值写进当前接入                                                                                                          |
| B16 | `settings/sections/use-model-inventory.ts:190-200`                                                                                                                         | 保存时对所有 secret 字段无条件 `writeProviderSecret(value \|\| null)` → 空值等于删除钥匙串条目；`parseConfigFields` 却是「跳过空值」，两处口径相反                                                          |
| B17 | `settings/sections/usage.tsx:28-40`、`stores/agent.ts:903-918`                                                                                                             | 「当前会话」页签直接对全局合并缓存求和，没有按 `activeSessionID` 过滤 → 混入其它会话用量                                                                                                                    |
| B18 | `chat/components/aside-plan.tsx:148-165`、`features/agent/plan-file.ts:81-88`、`plan-file-sync.tsx:50-70`                                                                  | 「保存到工作区」写入时补 `# 标题`，档案 body/digest 没同步 → 轮询立刻 `bumpRevision`，出现「计划已更新到 rN」的假提示                                                                                       |
| B19 | `chat/components/aside-tasks.tsx:297-300,600-602,836-843`                                                                                                                  | 任务详情：`openRuns` 不清空、`renderDetail` 不校验归属 → 先显示上一个任务的执行记录，「再跑一次/打开会话」指向 A 的 run                                                                                     |
| B20 | `chat/components/plan-recorder.tsx:44-66`、`plan-store.ts:507-508`、`plan-run-finish.tsx:66,83-91`                                                                         | 计划执行期间只要写入过一次 `running` 就被 `bumpRevision` 打回 `draft`，收尾钩子的 `status !== 'running'` 提前返回 → 终态永不落                                                                              |
| B21 | `chat/components/aside.tsx:210-300`、`aside-plan.tsx:364`                                                                                                                  | 「开始执行」无重入保护（`writeAgentMode` 是 await，窗口不小）→ 连点两次会发两份计划                                                                                                                         |
| B22 | `chat/components/aside.tsx:290`、`features/agent/tool-paths.ts:48-58`、`views/code/lib/path.ts:34`                                                                         | `normalizeToolPath` 不折叠 `..`，越界判定只覆盖绝对路径 → 相对路径可能拼出工作区外文件，或直接读盘失败                                                                                                      |
| B23 | `chat/components/use-sidebar-branches.ts:213-235`                                                                                                                          | 左栏只遍历现存工作区，指向已归档/未加载工作区的会话直接消失（搜索里却显示「未分组」）                                                                                                                       |

### P2 清单（择机）

> **实施说明（2026-11-15）**：清单全部处理完。落地口径：
>
> - **队列**：`sendPendingItem` 改成「发成功才摘掉」——`composer.send()` 在 `!canSend` 时
>   **静默返回**，以前先删再发会让这条凭空消失；回灌群发先存用户草稿、发完放回，被闸门挡下的行
>   转入「待发送」而不是丢掉；补发闸门改按**会话**记（组件不随会话重挂，布尔一旦置真会跳过下一个会话的确认）。
> - **审批档 / 模式**：两份 `patchPref` 各走一条写入队列（连点按点击顺序落盘，任务轮到自己时才读偏好）；
>   模式写完后**不 await** 推 goose 的那一步（它要 ACP 连接，卡住不该连带卡住「切模式」），
>   文案改成「工具权限立即生效，提示词从下一轮发送起生效」。
> - **上下文估算**：结构指纹补上 data part 内容（计划条目状态终于能进指纹），并加
>   `withTextLength` 档位（每 400 字符换一次指纹）——估算跟着正文长，但不逐 token 重渲染。
> - **模型设置**：保存 `await writeModelPrefs` 并给失败提示；模型切换失败不关浮层、弹错误。
> - **候选面板**：输入区声明 `aria-autocomplete/expanded/controls/activedescendant`，
>   面板为 `listbox`、选项为 `option` + `aria-selected`。
> - **路径转义**：带盘符 / UNC 的文本不再当转义串解（`C:\new`、`C:\temp` 原样保留），TS 与
>   Rust `agentTool.rs` 同一口径，两侧各有一条用例。
> - **计划进度**：`toActiveIndex` 对「全待办」返回 `-1`，元素把它当 idle —— 第一步不再显示「进行中」。
> - **写审阅**：`parseWriteReview` 只认整文件键（`before`/`after`/`*_content`），片段级
>   `old_string`/`new_string` 与 `edits[]` 一起走逐段审阅（能真的按段丢弃），不再出现「点了必失败」。
> - **来源清单**：结构化结果里已有同一 href 时，参数 URL 不插队（否则标题被一串查询词顶掉）。
> - **输出格式**：TS 兜底改成单行紧凑 JSON，与 Rust `value.to_string()` 一致。
> - **死代码**：删 `tool-card-sandbox-body.tsx`（全仓无引用）与 `collapseOutput` / `TERMINAL_PREVIEW_LINES`。
> - **右栏**：搜索进目录时祖先一起展开并读取；hunk 补完一页后再确认一次「填满没有」（不够一屏时
>   不会再有 scroll）；文件搜索加 180ms 防抖（列目录仍即时）；定向焦点带上会话归属，
>   切会话那一帧不再闪上一个会话的文件。
> - **任务**：「最近执行」优先取属于该任务的 runs（`allRuns` 只在打开「全部记录」时刷新）；
>   删任务同时清掉它的执行记录；已有任务的校验问题不再被 `isDirty` 挡住，按钮为什么是灰的会写出来。
> - **设置**：工具权限只回滚单条（不再整表回滚）；诊断报告带会话归属（切会话后不显示旧报告）；
>   撤销日程失败会冒错并提示；纯日期按**本地**零点解析（全天事件不再偏 8 小时）；
>   温度回填同时落盘；删掉当前接入后的兜底走 `findDefaultProviderID`（不拿没有模型的空壳行）；
>   `?section=` 变化会覆盖 `pickedID`（深链不再被首次点击永久盖住）。
>
> 门禁：`pnpm lint`（15 包）、`pnpm unit`（11 包，client 195 文件 / 1370 条）、
> `pnpm --filter @cogito/client build:core`、`pnpm check`、`cargo check --all-targets`、
> `cargo fmt --check` 全绿。

- 发送被拒仍删队列项（`composer-queue.ts:219-238`）；`pumpArmed` 只在组件挂载期复位（`:197-201`）；群发恢复用 `setText` 覆盖当前草稿（`:148-156`）
- 审批档/模式切换无串行化，连点后落地顺序可能与最后点击不符（`approval-switch.tsx:33-53`、`mode-switch.tsx:43-58`）；模式切换文案承诺「下一轮生效」但 `mode.ts:252-268` 立即推审批档
- 结构指纹不含 data part 内容与正文长度 → 上下文估算停在上轮快照（`use-structural-messages.ts:24-49`、`use-context-usage.ts:110-127`）
- 模型设置保存不 await、失败无提示（`model-settings.tsx:270-280`、`model-picker.tsx:355-360`）
- `@`/`/` 候选面板无 combobox/listbox 语义（`composer-input.aui.tsx:822-838`、`composer-triggers.tsx:645-652`）
- `unescapeLiteralEscapes` 把 `C:\new` / `C:\temp` 解成换行/制表（`tool-output.ts:71-84`、Rust 同源 `agentTool.rs:227-241`）
- 全 `pending` 的计划第一步显示「进行中」（`plan-steps.ts:20-33` + `agent-plan-state.ts:78-90`）
- 片段级 `edit`/`str_replace` 也出「审阅」按钮，点开必失败（`tool-card-read-write.tsx:141-148`、`write-review.ts:122-130`）
- `parseWebSources` 把参数 URL 抢先入列，结构化标题被去重丢掉（`parse-tool-result.ts:683-705`）
- Rust/TS 对未知对象的输出格式不一致（缩进 vs 单行，`tool-output.ts:119-131` vs `agentTool.rs:313-320`）
- 死代码：`ToolCardSandboxBody` 全仓无引用、`collapseOutput` 仅测试引用（`tool-output.ts:11,62-66,217-233`）
- 文件树搜索进入目录不展开祖先（`aside-files-tree.tsx:172-177`）；hunk 分页加载完不自动续页（`aside-diff-hunks.tsx:82-100`）；文件搜索无防抖（`use-workspace-file-picker-entries.ts:20-45`）；切会话闪一下旧预览（`aside.tsx:178,466-472`）
- 任务：「最近执行」优先用陈旧 `allRuns`（`aside-tasks.tsx:338`）；删除任务不清理 runs（`stores/automation.ts:354-372`）；非法既有任务保存按钮灰但无提示（`task-form.tsx:127,923`）
- 设置：工具权限连改回滚整表（`tool-permissions.tsx:71-84`）；诊断报告不随会话重置（`diagnostics.tsx:130-151`）；日程撤销无条件报成功（`stores/calendar.ts:141-151` + `plan-schedule-card.tsx:146-160`）；全天事件时区偏移（`features/agent/schedule-plan.ts:60-76`，`Date.parse('YYYY-MM-DD')` 按 UTC）；温度回填不落盘（`model-tuning-section.tsx:113-131`）；去重兜底用 `providers[0]` 且不落偏好（`stores/provider.ts:230-233`、`provider-upsert.ts:47-49`）；`?section=` 首次点击后失效（`settings.tsx:100-110`）

---

### Phase 9 — 会话标识与运行时（先修 A1、B1–B4）

> **实施说明（2026-11-13）**：39–43 已完成。落地口径：
>
> - **A1**：折算口径收成一处 `use-session-thread-id.ts::findSessionKey(threads)`（`remoteId ?? null`），
>   `useResolvedSessionID` / `useSessionThreadID` 都是它的 hook 包装，`aui.threads.getState()`
>   这类非 hook 场景直接传进去。**草稿期返回 null**（旧版 `useSessionThreadID` 会退回草稿 id，
>   等于让「`if (!threadID) return`」全失效，档案照旧写进没人读的键）。
>   写点已全部改用它：`AgentModeThreadSync`、`plan-recorder`、`aside-plan`、`aside-busy`
>   （目标轮次 / 用量 / 计划卡）、`plan-data-ui`、`plan-file-sync`、`plan-run-finish`、
>   `goal-auto-advance`、`composer-footer`、`use-context-usage`、`aside-context`、`thinking-effort`。
> - **A1 迁移**：草稿 id 无法映射回库内 id（晋升时保留草稿 id、只另给 `remoteId`），
>   所以是把**孤儿行删掉**而不是改写：`plan-store.hydrate()` 在启动那次全量读之后，
>   把 `sessionID` 以 `__LOCALID_` 开头的 `agent_plan` / `agent_goal` 行按 `sessionID`
>   批量 `toRemove` 并跳过入 cache（`plan-store.test.ts` 覆盖）。守卫条件放在
>   `features/agent/port/session-key.ts`（`DRAFT_THREAD_PREFIX` / `isDraftSessionKey`），
>   左栏分组也改用同一份常量。
> - **B1**：判据从「`mainThreadId` 为空」改成「当前主线程还没落库」（列表项无 `remoteId`），
>   `restored` 在**完成一次判定**后置真。
> - **B2**：只保留 `submitMode === 'ctrlEnter'` 的修饰键校验；`enter` 模式下带修饰键的 Enter
>   走 `sendFromComposer(aui, { steer: true })`，并统一 `preventDefault()`。
> - **B3**：`pumpArmed` 初值 false，等运行态确认后才允许回灌补发。
> - **B4**：`FocusAutomationSession` 用 `findSessionKey(aui.threads.getState())` 比对；
>   **已在该会话时走 `aui.threads.reloadMainThread()`**（`threads.reload()` 只刷列表、
>   `switchToThread(同一条)` 在 `isSameThread` 处直接返回空 Promise），
>   换会话时才 `reload()` + `switchToThread()`。
>
> 门禁：`pnpm lint`、`pnpm unit`（client 195 文件 / 1363 条）、
> `pnpm --filter @cogito/client build:core` 全绿。

39. **A1**：新增 `resolveSessionID()`（`threadListItem.remoteId ?? null`）并在所有「按会话存偏好/档案」的写入点改用它；`AgentModeThreadSync`、`plan-recorder`、`AsidePlan`、`goal-*`、`approval-switch`、`composer-queue`、`tasks` 统一；对已有 `__LOCALID_%` 行做一次性迁移。
40. **B1**：`RestoreRunningThread` 的判据改成「仍是未开始的草稿」（`status === 'new'` 或 `messages.length === 0`），且 `restored` 在**完成一次判定**后置真。
41. **B2**：`composer-input.aui.tsx` 去掉 `submitMode === 'enter'` 下 Ctrl/Cmd+Enter 的早退（运行中 steer、空闲普通发送），并补 `preventDefault`。
42. **B3**：队列回灌改为「等运行态确认」：读 `hasRunningBackgroundTurn` / 订阅 `run-state`，`pumpArmed` 初值 false，首次确认后再允许补发。
43. **B4**：`FocusAutomationSession` 改为已在目标会话时走 `aui.thread.reload()`（触发 `history.load`/resume），列表 `threads.reload()` 只在需要新条目时调。

### Phase 10 — 右栏与侧栏（A2、B10–B14、B21–B23）

> **实施说明（2026-11-13）**：44–52 已完成。落地口径：
> - **A2**：抽出纯函数 `aside-files-disk-update.ts::planDiskUpdate` →
>   `create | follow-disk | keep-buffer | conflict`（带 4 条单测）。缓冲区没改动时 `force` 跟随磁盘并重置基线；
>   有本地编辑且磁盘也变了 → 不动任何一边，`aside-files-preview` 顶部出冲突条
>   （「载入磁盘版本」/「保留我的修改」）；`save()` 落盘前先读盘比基线，不一致就拒绝并提示。
> - **B10**：`rootPathRef` 供 `openTerminal` 读最新根目录（订阅仍是 `[]`，但不再吃住首帧闭包）。
> - **B11**：`open-aside-context.ts` 加模块级一次性 `pendingExpand` + `takeAsideContextExpand()`，
>   卡片挂载时消费；事件订阅里顺手清掉，避免重复展开。
> - **B12**：placeholder 改「搜索会话标题…」（实现只匹配标题，不再承诺搜正文）。
> - **B13**：编辑态等 `toReadWorkspaceFolders` 完成才允许保存（期间显示「正在读取文件夹…」），
>   数据到达且用户没动过 draft 时回填；用户动过（`isDraftTouchedRef`）不再覆盖。
> - **B14**：`onMoreHunks` 带 `requestKeyRef`（`root|relative|oldOid|newOid|side`），
>   resolve 后比对不一致直接丢弃。
> - **B21**：`startImplement` 拆成「守卫壳 + `runImplement` 执行体」，`startingRef` 在 try/finally 里上下锁。
> - **B22**：`normalizeToolPath` 折叠 `.` / `..`，折完仍越界（以 `..` 开头）返回 `null`；+2 条断言。
> - **B23**：未被任何分支消费的 `sessionsByWorkspace` 桶并进「未分组」，与会话搜索同口径。

44. **A2**：`use-aside-files-editor` 的 revision 重读完磁盘后，不脏时 `findOrCreateModel(..., { force: true })` 并重置 `savedValueRef`；脏时弹冲突；`save()` 落盘前先比对磁盘（复用 `isSameText` 口径）。
45. **B10**：`openTerminal` 用 ref 读 `rootPath`（或依赖数组带上 `rootPath`），别让订阅端吃住首帧闭包。
46. **B11**：把「待展开上下文」做成模块级 pending 标记（或提到 `aside.tsx` 的 state 作为 prop），保证跨页签切换后仍能消费一次。
47. **B12**：placeholder 改「搜索会话标题」，或补消息全文检索（复用已有 FTS 口径）后合并结果。
48. **B13**：编辑工作区在 folders 未就绪时禁保存并显示骨架；数据到达且用户未改动时回填 draft。
49. **B14**：`onMoreHunks` 加 `requestKeyRef`（`rootPath|relative|oldOid|newOid|side`），resolve 后比对一致才 `setState`。
50. **B21**：`startImplement` 加 `startingRef` 首行短路（同 `tool-card-read-write.tsx:186`）。
51. **B22**：`normalizeToolPath` 折叠 `.`/`..`，结果仍以 `..` 开头返回 null，让 `locateTarget` 走「不在工作区」。
52. **B23**：分组时把「有 workspaceID 但桶未被消费」的会话并入「未分组」；搜索页用同一口径。

### Phase 11 — 工具卡与解析（A3、A4、B5–B9）

> **实施说明（2026-11-13）**：53–58 已完成。落地口径：
>
> - **A4**：`ToolAccumulator.cancelled` + `cancelOpenTools()`，在 `finish` / `aborted` / `error` /
>   无终态兜底五处收口；停在「等审批」的工具同时把 `approval.resolution` 标成 `cancelled`
>   （不退化成「已拒绝」）。`chat-model.test.ts` +4 条。
> - **B6/B7**：新增 `features/agent/tool-activity.ts` 的 `findToolActivity(status, isError, result)`
>   → `running | waiting | cancelled | failed | done`，终端条 / 任务进度卡 / 检索 / 联网 / 时间轴
>   五张卡统一用它；`result.isRunning === true` 判 running。`JobOutcome` 直接用内建的 `cancelled`。
> - **B5**：`tool-result` 早已不再改写 `approval.approved`；这次补上收据侧 —— 已允许但执行失败时
>   副标题写「已允许，但工具执行失败」并转 destructive 色调（`ApprovalState` 仍是四态，
>   加第五态要动 design 的契约与文案，留作后续）。
> - **B8**：`tool-card` 比较器改比 `status.type/reason` 与 `approval` 的标量；检索/联网的
>   `parse*` 套上 `useMemo`。
> - **B9**：`rebuildPatchText` 改游标定位 + 字符串切片（不再用 `replace`），多命中返回
>   `ambiguous` 并拒绝落盘，调用方 toast 说明。
> - **A3**：`agentTurn.rs` 不再递归截断结构内部 —— 超过 8KB 的 `input`/`output` **整段**换成
>   `{__truncated, bytes, preview}` 标记对象，单条事件超 8MiB 时退化成只留 `kind` 的骨架。
>   半截 JSON / 数组静默丢项都不再可能。

53. **A3**：`agentTurn.rs` 不再对 `tool-result.output` / `tool-call.input` 做结构内部截断（只按整条事件淘汰，或大 payload 落单独表并带 `truncated` 标记），保证输出仍是合法 JSON。
54. **A4**：`mapChatStreamToRunResults` 在 `aborted` / `error` / `finish` 时把仍无结果的 tool part 收口为 `incomplete(cancelled)`；卡片统一画「已中断」。
55. **B5**：`tool-result` 失败不再改写 `approval.approved`（另加 `outcome:'failed'`），把审批收据与执行结果解耦。
56. **B6 / B7**：抽 `findToolActivity(status, isError, result)` → `running | waiting | cancelled | failed | done`，所有工具卡共用；`result.isRunning === true` 也算「运行中」。
57. **B8**：`tool-card` 比较器改比标量（`status.type`/`status.reason`、`approval.approved`/`optionId`/`resolution`），或让适配器缓存稳定 `status` 引用；`parseRetrievalHits`/`parseWebSources` 套 `useMemo([props.result])`。
58. **B9**：`rebuildPatchText` 用 `replace(after, () => before)` + 游标定位（`indexOf(after, cursor)`），多次命中直接拒绝并提示；前置校验同步。

### Phase 12 — 任务与设置（A5、A6、B15–B20）

> **实施说明（2026-11-13）**：59–65 已完成。落地口径：
>
> - **A5**：新建会话的归属收进 `views/agent/chat/components/new-thread.ts` —— `startNewThread(host, workspaceID?)`
>   先 `rememberNextThreadWorkspace` 再 `switchToNewThread()`，命令层 `AGENT_NEW_TASK` 与侧栏「插入会话」
>   共用；切到已有会话 / 离开草稿槽调 `leaveNewThread()`（= `forgetNextThreadWorkspace()`），
>   草稿槽被丢弃后下一次新建不会指向上一个工作区。
> - **A6**：`TaskDraft.runAsKind: string | null`，`toRunAsKind` 只认字典里那两位值（不认识 → `undefined`），
>   `toSaveInput` 原样回写；`toCloudInput` **只在不认识时才省略该字段**（缺省写 `user` 会把「以租户身份运行」
>   静默改掉）。服务端任务的执行身份在服务端配置，界面只读展示
>   （`findLabel(DICT_TYPE.AUTOMATION_RUN_AS, …)`），不开本地编辑入口。`model.test.ts` +1 条。
> - **B15 / B16**：`openEditor` 进 `loadingConfig` 闸门（配置读完前 `handleSave` 只提示不动手）；
>   配置读取加 `editorSeqRef` 请求序号，中途切了别家接入就整份丢弃，`finally` 只关自己那次闸门；
>   空密钥不再调 `writeProviderSecret`（空 = 用户没改，不是要删钥匙串）。
> - **B17**：用量页 `rows` 先按 `usage.sessionID === activeSessionID` 过滤再汇总，切会话不会把旧会话的
>   token 记到新会话头上。
> - **B18**：`aside-plan` 保存后回读一次文件（`readPlanFile`）再 `savePlan({ source: 'file', body, digest })`，
>   档案 digest 与磁盘一致；否则 `plan-file-sync` 下一轮就判「文件变了」，弹出假的「计划已更新到 rN」。
> - **B19**：`openRuns` 先把 `activeId` 切过去并清空 `runs`，详情页再按 `runsOwnerID === task.id`
>   与 `run.automationId` 过滤；切任务那几帧不再显示上一个任务的执行记录
>   （「再跑一次 / 打开会话」不会指错）。
> - **B20**：`bumpRevision` 三态化 —— `draft` → `draft`、`running` → **保持 `running`**（只让 revision 前进）、
>   `done` / `interrupted` → `superseded`。以前 running 回落 draft，`plan-run-finish` 的
>   `status !== 'running'` 直接早退，终态永远写不进去；「改过版」由 `revision > executedRevision`
>   （`isPlanStale`）表达，不再靠状态回落。
>
> 门禁：`pnpm lint`（15 包）、`pnpm unit`（11 包，client 195 文件 / 1362 条）、
> `pnpm --filter @cogito/client build:core`、`pnpm check` 全绿。

59. **A5**：把「记住归属工作区」收进命令层（`AGENT_NEW_TASK` 与侧栏共用），并在切到已有会话/放弃新会话时清空草稿槽。
60. **A6**：`TaskDraft` 带上 `runAsKind`（只读展示 + 原值回传），`toSaveInput` 原样回写；旧行缺字段按「不传」而非默认 `user`。
61. **B15 / B16**：provider 弹框加 `loadingConfig` 闸门 + 请求序号丢弃过期结果；空 secret 不调用 `writeProviderSecret`（删除走单独动作）。
62. **B17**：用量页按 `row.sessionID === activeSessionID` 过滤后再汇总。
63. **B18**：`handleSave` 用写盘时的同一份 body（或 `readPlanFile` 结果）同步 `savePlan({ body, digest })`，并让 `plan-file-sync` 跳过本进程刚写过的路径。
64. **B19**：`openRuns` 开始时先 `set({ runs: [], activeId: id })`，渲染前按 `run.automationId` 过滤。
65. **B20**：`bumpRevision` 在 `running` 时保留 `running`（只记 pendingRevision），或 `plan-run-finish` 以「本轮已开跑」为判据而非 `status === 'running'`。

---

## Relevant files

- `apps/client/src/features/agent/acp/session.ts` — `resumeThreadSession`(≈1026) / `resumeThreadRun`(≈2085) 的 `mcpServers`、`findCorexMcpServers`/`findCogitoMcpServers`、`verifyToolSurface`、`runThreadPrompt`、`requestThreadPermission`、`ensureThreadSession`
- `apps/client/src/features/agent/acp/loaded-session.ts` — `LoadedQueue` / `createLoadedSession.prompt`
- `apps/client/src/features/agent/acp/goose-extensions.ts`、`views/agent/settings/sections/{extensions,diagnostics}.tsx` — 内置 MCP 展示
- `apps/client/src/features/agent/port/model.ts`、`packages/chat/src/adapters/chat-model.ts`
- `packages/design/src/assistant/edit-message.aui.tsx`
- `apps/client/src/features/agent/{approval,effective-approval,goal-run,agent-tools}.ts`、`agent-tools.lock.json`、`tool-labels.ts`、`tool-risk.ts`
- `apps/client/src/features/agent/model/prompts.ts`
- `apps/client/src/features/agent/goal-run.ts`（`advanceGoal` / `beginGoalTurn` / `renewGoalTurn` / `finishGoalRun` / `resumeGoalRun` / `isAbortedRun`）、`goal-continue.ts`、`plan-store.ts`（`GoalRecord` / `recoverInterruptedGoals` 入口）
- `apps/client/src/views/agent/chat/components/{goal-auto-advance,composer-footer,plan-run-finish,aside}.tsx`
- `apps/client/src-tauri/crates/core/src/tools/terminal.rs`（`READ` / `WRITE` 的 schema）、`apps/client/src-tauri/src/bridge/app_tools.rs`（`terminal_read` / `terminal_write` / `text_arg`）、`apps/client/src-tauri/src/utils/terminal.rs`（`TerminalRun` / `TerminalRead` / `resolve_agent_session_scoped`）、`apps/client/src-tauri/crates/mcp/src/main.rs`（`call_tool` 错误回抛）
- `apps/client/src/features/automation/runner.ts`、`views/agent/chat/components/{approval-switch,tool-card-approval-bar,parse-tool-result,aside-plan,aside-busy,aside-files-preview}.tsx`
- `apps/client/src-tauri/crates/core/src/tools/**`（35 个 const）、`crates/mcp`
- `apps/client/src-tauri/src/system/sidecar_command.rs`（`mcp_path`）、`tauri.conf.json`

---

## Verification

1. `pnpm unit` + `pnpm lint`；新增单测：`session/load` 带 MCP 名单、迟到终态丢弃、35 个工具读写判定与 Rust `effect` 一致、未知工具按写、`stripServerPrefix` 双前缀、`plan-draft` 非 json 代码块不告警、`edit-message` focusout。
2. 手工（**正式包**，devCsp 掩盖 CSP）：
   - 冷启动进已有会话 → 诊断页工具面非空（35 + 7），控制台无 `缺少 app_terminal_run`；
   - 该会话让 agent 跑一条命令（走右栏终端）、查一次代码引用工具；
   - 停止 → 立刻「重新生成」：正常流式，无空白完成消息，无 `[agent.port.run]` 空错误；
   - 编辑中段消息 → 「更新」正常；编辑态点空白回气泡；点「更新」不被 blur 抢先取消；
   - 计划模式开关显示有效档且不可绕过；`readonly` + `goal` 任务不被抬成 auto；第三方 MCP 写工具在 ask/readonly 下分别弹审批/被拒；
   - marketplace 内网 favicon 正常、终端 Nerd 图标正常、无 CSP 违规；
   - 计划模式产出含普通代码块：控制台无 plan-draft 刷屏；
   - 目标模式发一条任务：整轮流式期间 footer 一直是「第 n/6 轮」而不是「已暂停」，本轮正常结束后才出现 `GOAL_CONTINUE` 续跑；
   - 目标推进中切走会话再切回：记录仍是 `running`（不被 `hydrate` 打成 `interrupted`），footer 不出现「已用尽」且无可继续入口；
   - 点「继续」后：只在真的发出去之后进入 running，不出现「刚点继续又变已暂停」；
   - 目标推进中手动点「停止」：footer 显示「已暂停」且「继续」可用（用户停止是预期暂停）；
   - 终端契约：接回会话后让 agent 读终端输出，不再出现「缺少 id 或 cwd」；
   - 故意只传 `cwd`、以及什么都不传：都能读到本会话终端；传 `sessionId: "agent:<cwd>"` 也生效（别名）；
   - 故意传一个不存在的 id：错误里能看到同 cwd 的候选 id 与正确调用示例；
   - `app_terminal_run` 的 `output` 首行带 `[terminal id=… cwd=…]`（模拟长输出 `slice(-N)` 后仍能拿到 id）；
   - 新会话（未落库）里选「自动审批」再发首条消息：goose 收到的就是自动审批（修 A1 前会拿到全局默认）；重启后该会话的计划/目标档案仍能读到；
   - 新会话归属：点左栏「+」选工作区后放弃，再从标题栏新建 → 不会指向上一个工作区；
   - 右栏打开一个文件后让 agent 改它：不脏时应自动重载新内容；脏时弹冲突，不允许静默覆盖；
   - 停止一轮带终端工具的回答：卡片变「已中断」而非永久「执行中」；重启应用后仍是「已中断」；
   - 长输出工具结果（>8 KiB）在刷新恢复后：网页/检索/文件树卡仍能结构化渲染（不再退化成原始文本）。
3. 改名后全局自查：`grep -rn "app_workspace\|app_terminal\|app_knowledge\|app_browser\|app_code\|app_agent_\|app_calendar"` 只剩文档历史说明，代码与提示词零命中。

---

## Decisions

- **内置 MCP 一律随会话注入**（`session/new` 与 `session/load` 同一份名单）；`mountsCogito` 由实际注入推导。
- 「扩展」页只显示内置 MCP 的**只读卡**；工具名详单进「诊断」页。
- 审批真源 = 会话 `mode` + 硬禁用名单；未知工具 fail-closed。
- 资源访问只放宽 CSP；不加 Rust 图片代理，picsum 保持回落。
- 工具命名 `app_*` → `cogito_*`，不保留旧名兼容；前端统一 `stripServerPrefix` 后匹配，保证不出现 `cogito__cogito_*`。
- `JSON_BLOCK` 只认 json 代码块；解析失败不 warn。
- **目标模式的「一轮结束」以消息 id 为凭据**：`turnStartMessageID` 之后的 assistant 消息才算本轮收尾；`paused` 只由「真的结束了但没有续跑条件」或用户停止写入，绝不由「记录刚变 running」的 effect 触发。
- 租约必须**有续期**（否则 10 分钟就自愈成 `interrupted`）；`interrupted` 是可继续的中断态，不是终态。
- **工具参数名以模型先验为准加别名**（`sessionId`→`id`、`lines`→`maxChars`），而不是只写文档；工具面必须靠 `tools/list` 的 `inputSchema` 教会模型，提示词里只写名字不算契约。
- 所有工具错误必须可自愈：至少包含「错在哪个参数 / 可选值 / 正确调用示例」之一，且省略 id 时默认回落本会话。
- **会话标识只用 `remoteId`（`resolveSessionID()`）**：`mainThreadId` 是草稿槽，不能作为任何持久化键。
- 工具 part 的终态要包含 `cancelled`；「是否进行中」由统一的 `findToolActivity()` 判定，禁止各卡自己写 `status.type === 'running'`。

## Further Considerations

1. `readonly` 是否改用 goose `chat` 模式：需实测（`readonly` 下调 `cogito_workspace_write` 看是否仍发 `session/request_permission`）。确认前保持 `smart_approve + never_allow`。
2. 若 goose 的 `session/load` 根本不接受 `mcpServers`（拒绝参数），退路只有两条：接回后用 `session/extensions/add` 重挂，或放弃 resume 改 `session/new`（丢 goose 侧上下文）。**Phase 0 第 1 步会先给出结论**。
3. `aside.tsx::startImplement('agent')` 会无条件 `stopGoalRun(threadID)`，即在目标推进中途点「开始执行」会暂停正在跑的目标。若这是有意的（换目标就该停旧的），就在 UI 里说明；否则需要改成「只在目标已完成/已暂停时清理」。
4. 目标推进中「用户插话」与「排队消息」目前共用 `interjection` 一条判据；排队消息发出后最后一条也是 user，容易把正常排队误判成插话。Phase 7 的基线校验先兜住，是否要区分「排队→继续」还是「插话→暂停」待产品口径。
5. 外层 JS 沙箱 MCP（`{"code":"async function run(){...tools.call(...)}"}`）不在本仓，它会把任意非法调用原样转发；若用户常用它，可考虑在 `cogito-mcp` 的 `tools/call` 里做一层「未知参数丢弃 + 别名归一 + 错误提示带 schema 摘要」的兼容层。
6. `unstable_enableMessageQueue: true` 下编辑中段消息会 `queue.clear()`，排队项 parentId 还会被改写；Phase 1 修完若仍有排队异常，再评估关闭队列。
