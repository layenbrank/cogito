# Plan: Agent 应用现代化 + 完整体验（v3）

## TL;DR
保留 goose ACP 后端与 `packages/chat` 的 `ChatModelPort` 契约（单一事实源），把前端**升级到最新 assistant-ui（0.15.32）、用元素库替换手写组件**，补齐「完整 agent 体验」。运行时层保留 hook API（`useLocalRuntime`/`useRemoteThreadListRuntime`，未弃用）；迁出到 store/resource 架构为可选优化。可安装 `@assistant-ui/react-o11y`、`heat-graph`，允许破坏性重构，能删旧路径就删，禁止新旧双轨。

## 关键结论（本轮调研）
1. assistant-ui 元素库（~100 个）经 registry 安装到 `components/assistant-ui/elements/`；用户列的 40 个覆盖全部缺口，见各 Phase 映射。
2. 版本与运行时事实（已核验 npm latest：`@assistant-ui/react@0.15.32`、`core@0.3.32`、`store@0.3.22`、`react-o11y@0.0.48`、`heat-graph@0.0.26`）。`useLocalRuntime`/`useRemoteThreadListRuntime`/`useExternalStoreRuntime` **在 `@assistant-ui/react` 同处 `legacy-runtime/` 导出**（index.ts 157/173/177 行），三者都是 hook 运行时 API，**均未标 @deprecated**；「legacy」是 `@assistant-ui/react` 对 hook 运行时的打包路径命名，不是弃用标记。真正「非 legacy」是 store/resource 架构（`AuiConfig` + `RemoteThreadList` 客户端 + `@assistant-ui/tap` resource）。
3. `backgroundThreads:true`（仅 `RemoteThreadList` 客户端支持）原生提供「切走仍在跑 + per-item isRunning 实时」；若迁移则退役 `run-state.ts`/`host.tsx` toast。未迁移时保留现有 `background-turn.ts`+`run-state.ts` 方案。
4. `trace-waterfall` 元素基于 `useMessageTiming`+`s.message.parts[].timing` 派生两级瀑布，无需 react-o11y 即可起步；react-o11y 用于更深层嵌套 span（可选）。

## 实施规约（全 Phase 适用）
- 文件组织：按域拆目录、单文件域平铺；导出名=文件名=职责；模块末 `export { ... }`；默认不建 barrel。元素统一 vendored 到 `packages/design/src/assistant/elements/`（遵循既有 `*.aui.tsx` 约定），业务侧不直接 import 第三方元素。
- 导入：同目录 `./x`；跨目录用别名 `@/...`；层边界靠 lint。
- 命名：简洁；常量/枚举键/API 全大写蛇形；接口/类型 PascalCase；禁 `get`/`load`/`apply`/`create` 前缀（find/fetch/parse/bootstrap 代替）；布尔 is/has/can；集合复数不含 list；UI 区域用 `surface` 不用 `panel`。第三方（assistant-ui）导出名不在此列。
- 错误：catch 一律 throw 或至少留痕（console/toast/事件总线），禁静默；降级先留痕；不 catch 优于 catch；批量失败用 AggregateError；日志前缀 `[模块] 说明:`。
- 异步：独立并行用 `allSettled` 逐条处理；仅真 fail-fast 用 `Promise.all`。
- 简化：可选链/空值合并优先；`!x` 代 `x!==null&&x!==undefined`；布尔上下文不写 `Boolean(x)`；0/''/false 合法值处禁用假值判断。
- UI：统一组件库，不手写 `<button>`/`<dialog>`；按压反馈用色阶（hover/active bg）不用位移缩放；token 唯一源；语义 token 类不写硬编码色；新组件走 registry。

## Phase 0：升级 + 非 legacy 架构迁移（基础，破坏性）
1. 升级 assistant-ui 全家到最新（`@assistant-ui/react`/`core`/`store`/`react-markdown`；锁定确切版本号于实施时），加 `@assistant-ui/react-o11y`、`heat-graph` 依赖。
2. 运行时层**保留** `useRemoteThreadListRuntime` + `useLocalRuntime`（当前支持路径，适配 `ChatModelPort` 成本最低）。「迁出 hook 运行时 → `RemoteThreadList` 客户端 + thread resource」降级为**可选优化**（单独评估，不阻断其余 Phase）：`backgroundThreads` 仅存在于 `RemoteThreadList` 客户端组件，迁移需用 `@assistant-ui/tap` 的 `resource`/`withKey` 自建 thread 资源，成本高、文档不足。默认**不做**，靠现有 `background-turn.ts` + `unstable_resume` 达成同等效果。
3. （条件，仅在迁移 `RemoteThreadList` 客户端后执行）退役 `acp/run-state.ts`、`features/magnetic-tile/host.tsx` 的后台 toast、`use-sidebar-branches.ts` 的 isRunning 拼接 → 改读 `s.threads` / `ThreadListItemState.isRunning`。未迁移则跳过。
4. 清理 deprecated：`unstable_queueClearOnCancel`/`unstable_queueClearOnRewind`（2026-11-05 后移除）、`QueueItemState.prompt`→`parts`、`steerQueueItem`→`moveQueueItem`。
5. `background-turn.ts` 收敛为纯「detach 不 abort ACP 泵」+ resume 续尾，删除与 `backgroundThreads` 重复的运行态追踪。

## Phase 1：后台任务收件箱（基于元素）
- 引入元素 `background-inbox`（手写 `packages/design/src/assistant/background-inbox.aui.tsx`）：数据从 `run-state.ts` 的 `useRunningThreads()`+`useFinishedThreads()` 投影运行/就绪行（`s.threads` 的 `isRunning` 未开 backgroundThreads 不准确，故不走文档版数据源）；`onOpen` → `aui.threads.switchToThread(id)` + `clearFinishedRun(id)`。
- 入口放在左栏/标题栏（替换现有「生成中…」与 toast）。
- 加固 `background-turn.ts`：persister 单槽→keyed；`ensureBackgroundTurn` 校验 `start` 身份；detach 判定在适配器边界归一；「done 且无 UI 订阅」persister 必达；补单测（泵异常/persister/60s 保留/复用/unbind/票据队列）。

## Phase 2：可观测性与用量（元素 + 可选 react-o11y）
- `trace-waterfall`：新建 `useMessageTrace`（`useMessageTiming`+parts 派生 span），挂消息根。
- 用量：`cost-meter`、`quota-banner`、`context-display`/`context-breakdown`（数据源 `goose-usage.ts` 已有点位）。
- 活跃热力：`heat-graph`（需持久化 run 时间戳）或 `activity-graph` 元素。
- 深层 span（子图/工具内部）：可选 `@assistant-ui/react-o11y`，由 ACP 事件旁路喂 `SpanData[]`；不兼容则退回 trace-waterfall 两级视图。

## Phase 3：重新生成 / 编辑 / 分支
- 元素：`edit-message`、`message-branches`、`regenerate-menu`。
- 后端决策：ACP 是否支持 checkpoint fork；支持→在 ExternalStoreAdapter 暴露 edit/regenerate；不支持→显式禁用并留痕，不伪装。
- 轻量替代：`message-actions.ts` 加「重新发送该消息」（该 user 消息作新 turn）。

## Phase 4：Follow-up 建议
- `useExternalStoreRuntime` 的 `suggestions` 适配器（`createSuggestionAdapter`，键名 `suggestion`）+ 元素 `follow-up-suggestions`。
- 生成策略：优先本地启发式（最后工具结果/计划完成度），避免为建议多打一次 LLM。

## Phase 5：工具卡与检索/终端元素化
- 用 `tool-timeline`、`terminal-block`、`reviewable-diff`、`code-diff`、`retrieval-chunks`、`tool-call`/`tool-fallback`/`tool-group`/`tool-error` 替换 `tool-card-*`/`parse-tool-result` 手工分派（保留 ACP→ChatStreamEvent 映射，删除旧渲染路径）。
- 工具流式：`useToolArgsStatus`（参数流式）+ `useToolCallElapsed`（耗时）。

## Phase 6：计划 / 日程 / 审批 / 追问元素化
- `agent-plan`、`todo-list` 替换 plan data part 渲染与 aside-busy 的 PlanEntryList（`findLatestPlan` 仍作数据源）。
- `schedule-card` 替换 `plan-schedule-card.tsx`（`parseSchedulePlan`/`toWrites`/`findOverlaps` 仍作逻辑）。
- `approval-card`、`option-list`、`question-flow`、`elicitation-form` 替换 `tool-card-approval-bar.tsx`/`elicitation-data-ui.tsx`（回执仍走 `chatModelPort.respondToApproval/respondToElicitation`）。
- 决策：是否把审批整体迁入 `defineToolkit`+`humanTool` 体系（ACP 审批是独立事件通道，评估成本，默认保留现通道）。

## Phase 7：流式 / 状态 / 错误 / 附件 / 线程辅助
- 流式与状态：`streaming-text`、`thinking-indicator`、`agent-status`、`confidence-marker`、`reasoning-effort`、`loading-state`、`day-separator`、`message-timing`（timing 补在 `mapChatStreamToRunResults`：ttfb/totalStreamTime/chunks/tokens/toolCalls；resume 只测实时尾部）。
- 错误与恢复：`error-state`、`draft-restore`、`stopped-run`、`connection-state` + `MessageNotSentError` 恢复草稿。
- 附件：接 AttachmentAdapter + 元素 `attachment`/`composer-attachments`（文本/文件先行；图片多模态 blocked on PR5）。
- 辅助：`thread-search`（替换/增强 `session-search`）、`composer-context`、`canvas-split`。

## Phase 8：多智能体与数据可视化（按需，低优先）
- `subagent-list`、`agent-card`、`agent-status`（多智能体/委派）。
- `data-table`、`chart`、`diagram`、`flow-graph`、`number-ticker`、`image-gallery`、`timeline`、`job-progress`、`comparison-card`、`recommendation-card`、`artifact-card`。
- 仅在相应工具结果/生成式 UI 落地时引入，不为凑全而引入。

## 决策
- 架构：升级到最新（0.15.32）；运行时层保留 `useLocalRuntime`/`useRemoteThreadListRuntime`（hook API 为当前支持路径，未弃用）；`ChatModelPort` 契约保留为单一事实源。迁出 hook 运行时为可选优化。
- 元素采用：registry 引入、vendored 到 `packages/design/src/assistant/elements/`，替换即删旧路径（禁双轨）。
- 审批/工具体系：默认保留 ACP 通道；迁移 toolkit 体系为独立评估项。
- 分支/图片多模态：以后端能力结论为准，不支持则禁用不伪装。
- 顺序：Phase 0 → Phase 1 → (Phase 2 ∥ 4 ∥ 5) → Phase 6 → Phase 7 → Phase 3 决策落地 → Phase 8 按需。

## 验证
1. Phase 0：`pnpm lint` + `pnpm unit` 通过；无 legacy 门面 import；切走线程 run 继续、侧栏 isRunning 实时。
2. Phase 1：后台收件箱显示 running/ready/failed，点击 collect 跳回线程；background-turn 单测通过。
3. Phase 2：多工具任务轨迹瀑布流式刷新；cost/context 数值与 `goose-usage` 一致。
4. Phase 4：首轮结束出现 follow-up 建议可发送。
5. Phase 5：工具流式参数标注 + 耗时；终端/代码/检索各卡片渲染正确。
6. Phase 6：计划/日程/审批/追问交互与现状等价且不丢功能。
7. Phase 7：打字机、TTFT/tokens/s、断网恢复草稿、文本附件上传、线程搜索可用。
8. 全量回归：现有 agent 主链路（多工具任务、审批、追问、计划、日程、dock）行为不回归。

## 进一步考虑
1. hook 运行时 vs store/resource 架构：`useLocalRuntime`/`useExternalStoreRuntime`/`useRemoteThreadListRuntime` 在最新版同处 `legacy-runtime` 导出且未弃用；「非 legacy」= store/resource（`AuiConfig`+`RemoteThreadList` 客户端+`@assistant-ui/tap`）。迁 resource 架构为可选优化，默认保留 hook 运行时。
2. 元素 vendoring 粒度：逐元素单文件 `*.aui.tsx` 进 `packages/design/src/assistant/elements/`，还是整目录引入后由 `components.json` registry 管理——以现有 `components.json`+`scripts/registry` 流程为准。
3. `backgroundThreads` 常驻内存成本：所有访问过的线程保持挂载，长会话需评估上限/回收策略。
