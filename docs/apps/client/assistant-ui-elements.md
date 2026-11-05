# assistant-ui 元素接入现状（Agent 体验）

对照 <https://www.assistant-ui.com/elements> 的 12 个元素，盘点本仓
`@cogito/design/assistant/*` 的落地情况。**设计包基本齐全**，缺的是「数据源」和「接线」。

> 2026-11-02 更正：上一版把 message-queue 记成「未接入」是**错的**——当时只 grep 了
> `apps/client`，而队列的大头在 `packages/design`（`composer-queue.aui.tsx` + `thread.aui.tsx`）。
> 教训：盘点要同时搜 `apps/` 与 `packages/`。

| 元素 | 设计包实现 | 接入情况 | 说明 / 下一步 |
| --- | --- | --- | --- |
| agent-plan | `plan.tsx`、`task.tsx` | ✅ | `plan-data-ui.tsx`（ACP `plan` 事件 → `data` 部件）+ `aside-plan.tsx`（右栏计划页签） |
| background-inbox | `background-inbox.aui.tsx` | ✅ | `use-background-runs.ts` + `aside-busy.tsx`：后台会话/后台任务的收件箱 |
| schedule-card | `schedule-card.aui.tsx` | ✅ | `plan-schedule-card.tsx`（计划里「定时执行」的那张卡） |
| composer-context | `composer-trigger.tsx` | ✅ | `composer-context-menu.tsx` / `composer-extensions-pane.tsx` / `workspace-file-picker.tsx`（@ 引用、扩展、工作区文件） |
| terminal-block | `terminal.tsx` | ✅ | `tool-card-terminal-body.tsx` + `features/terminal`（右栏常驻终端） |
| tool-timeline | `tool-group.aui.tsx`、`trace-waterfall.aui.tsx` | ✅ | `process-group.tsx` / `tool-group.tsx` / `message-trace.tsx`（思考 + 工具的折叠时间线） |
| loading-state | `shimmer.tsx` | ✅ | `agent-loading.tsx`（面板级 Shimmer，首处用于审阅面板）+ 思考态走 `ReasoningTrigger` 的 `active` 文案 |
| message-queue | `composer-queue.aui.tsx`、`queue.tsx` | ✅ | 见下节「消息队列」 |
| context-breakdown | `context.tsx` | ⚠️ 部分 | 只有一处用量展示，没有「按来源拆解（系统提示 / 工具结果 / 附件）」。需要 `packages/chat` 适配器给出分段用量 |
| mcp-server-panel | `panel.tsx`、`package-info.tsx` | ⚠️ 部分 | `package-info.tsx` 已用于扩展/MCP 信息；没有独立「MCP 服务器面板」（连接状态、工具列表、启停） |
| checkpoint-history | `checkpoint.tsx` | ❌ 未接 | 没有 checkpoint 数据源（ACP 没有「回到这一轮之前」的事件）。需要本地快照（工作区 revision + 文件 diff）才能撑起来 |
| logos | — | ❌ 缺组件 | 设计包里没有供应商/模型 logo 组件；`file-name-icon.ts`、`labels.tsx` 只覆盖文件图标与文案 |

## 消息队列

**链路**（全部已生效）：

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 打开能力 | `views/agent/chat/runtime.tsx` | `unstable_enableMessageQueue: true` → `thread.capabilities.queue` 为真 |
| 发送 | `composer-input.aui.tsx` | 运行中按 `Enter` = **入队**；`Ctrl/Cmd+Enter` = **插队**（中断当前轮立即发送） |
| 列表 | `composer-queue.aui.tsx`（`ComposerQueuedStrip`，渲染在 composer 内） | 每条可「插队 ⚡ / 移除 ✕」，标题给出口径提示 |
| 计数 | 发送按钮右上角徽标 | 运行中队列非空时显示条数（`labels.queuedMessages`） |
| 停止 | `unstable_queueClearOnCancel: false` | **只中断当前这一轮**，队列里的消息稍后照发（产品口径，2026-11 明确） |

### 元素视觉（`message-queue.aui.tsx`，按官网真实渲染的 DOM 校准）

元素本体收费，官网只给示例块；样式按 elements/message-queue 页里**渲染出来的 DOM**取类名，
行为自己写。字号不照搬元素里的 px 值，统一走本仓档位（元信息 `text-xs`、正文 `text-sm`）；
共享 token 在 `elements/surfaces.tsx`（`field` / `ghostButton` / `mono` / `rowEnter`）。

| 部位 | 口径 |
| --- | --- |
| 「正在运行」行 | `runningText` 传了才渲染（导出 `MessageQueueRunningRow`）：蓝点 `animate-ping` + 正文 `text-sm` + 右端 `running` 标签。**默认不传**——线程里当前轮的用户消息已在对话流里，重复一遍会被读成消息重复 |
| 标题 | 左 `N queued`（`mono` 即 `text-xs`、`tabular-nums`）；展开态右端是「本轮结束后自动发送」（`queueSendsWhenFinishes`），折叠态换成第一条正文预览 |
| 条目 | `field` 表面 + `rounded-2xl py-2 pr-2 pl-3`、`rowEnter` 入场；序号 `mono w-3 tabular-nums`；正文 `text-foreground/60 text-sm truncate` |
| 行内动作 | 上箭头（`lucide:arrow-up`，`text-foreground/25 size-3`）= 插队；`lucide:x` `size-3.5` = 移除，按钮 `ghostButton size-6`，无障碍文案带正文（`labels.queueRemoveItem(text)`） |
| 展开体 | `max-h-44` + 滚动（官方示例永远展开，会顶掉半个屏幕，这里默认折叠） |

`extraCount` / `extraPreview` / `renderText` / `renderItemActions` 四个注入点留给 app：`@chip` 标签、
「取回编辑 / 上移 / 下移」这些库没给 primitive 的操作。

**已知限制：队列是内存态。** 刷新页面 / 换会话 / 重启就丢，且丢得无声。

### 为什么暂不做持久化

不是「懒得做」，是三条硬约束叠在一起：

1. **公开 API 只能读**：`composer.queue` 在客户端状态里是 `readonly QueueItemState[]`；
   能往队列里塞消息的写接口（`enqueue` / `steer` / `move`）挂在 runtimes 内部的
   `MessageQueueController.adapter` 上，`useLocalRuntime` 没把它暴露出来。
   当前唯一能把内容送进队列的公开路径是 `composer.send()`——而它同时会**触发运行**。
2. **「恢复」与「自动重放」难以区分**：如果按「恢复即入队」实现，重启后队列会自己往下跑，
   等于用用户不记得的内容向 goose 会话真发消息、真调工具（还可能弹审批）。
   要做对，得先有「恢复为待确认」的中间态，属于新交互，不是加一行持久化。
3. **要落哪一层还没定**：队列跟线程、跟 ACP 会话、跟工作区都相关，
   落 Tauri Store（非密偏好）与落 SQLite（领域实体）语义不同；定错位置后面迁移更贵。

**如果要做，建议的轻量方案**（不需要内部 API）：卸载/切会话时把队列文本写进该线程的
草稿存储，下次打开只**预填输入框**并提示「上次有 N 条未发送」，由用户决定是否发——
语义安全、可增量实现。需要的话单开一条任务。

## 编辑已发送消息（edit-message）

元素本体是收费产物，视觉按官网示例块重写（`field` 表面 + `rounded-2xl p-3.5` 的编辑壳），
行为自己实现，文案走 `labels.editDiscardsReplies`。

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 进入编辑 | `thread.aui.tsx`（`UserActionBar` 的铅笔） | `ActionBarPrimitive.Edit` → `s.message.composer.isEditing` |
| 编辑壳 | `edit-message.aui.tsx`（`MessageEditComposer`） | 原地换成 composer，`ComposerPrimitive.*` 自动作用域到这条消息自己的 edit composer |
| 丢弃提示 | 同上（`findDiscardedReplies`） | 数「当前分支上这条消息之后的助手回复」，`> 0` 才显示 |
| 取消 / 发送 | 同上 | Cancel 丢草稿回气泡；Send 把改写作为同父新分支发出去（不删历史，分支切换可回看） |
| standalone | 同上（`EditMessage`） | 受控版：`editing` / `value` / `discardedReplies` 由 app 持有 |

## 建议顺序（按「改动量 ÷ 收益」排）

1. **context-breakdown**：适配器在每次请求前算一次分段 token（系统提示 / 工具结果 / 附件 / 历史），
   配合「上下文快满」提示能直接减少截断。
2. **mcp-server-panel**：扩展页已有扩展清单，补「连接状态 + 工具开关」即可复用 `panel.tsx`。
3. **checkpoint-history**：需要先把每轮的 `bumpWorkspaceRevision` + 文件快照落盘，属独立特性。
4. **logos**：低优先，随模型选择器一起补。

## 约定

- 所有可见文案走 `assistant/labels.tsx`（`useAssistantLabels`），组件里不写死中文。
- 新接入元素一律做 `*.aui.tsx` 适配层（`makeAssistant*UI`），不要在业务组件里直接用 primitives。
