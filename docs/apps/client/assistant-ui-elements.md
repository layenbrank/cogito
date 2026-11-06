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
| reviewable-diff | `reviewable-diff.tsx` | ✅ | 写文件工具卡的「审阅」入口：把这次写入的 diff 切块，逐块保留 / 丢弃后真的写回文件。见下节 |
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
| 条目 | `field` 表面 + `rounded-2xl py-2 pr-2 pl-3`、`rowEnter` 入场；序号 `mono w-3 tabular-nums`；正文走 `ComposerChipText singleLine`（多行摊平成一行再 `truncate`，chip 限宽 `9rem`），行高固定 `py-2 leading-5`；正文多于一行时右端出现 `⏎ N 行`（`labels.queueLines`），`title` 保留全文 |
| 行内动作 | 上箭头（`lucide:arrow-up`，`text-foreground/25 size-3`）= 插队；`lucide:x` `size-3.5` = 移除，按钮 `ghostButton size-6`，无障碍文案带正文（`labels.queueRemoveItem(text)`） |
| 展开体 | `max-h-[min(11rem,32vh)]` + 滚动（官方示例永远展开，会顶掉半个屏幕，这里默认折叠）；折叠头同样走单行预览 + 行数标记 |

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

## 工具卡（2026-11 收敛为「一个外壳 + 三处专项」）

旧做法是 ai-elements 的**重卡片**（`Tool`：`border` + `bg-card` + `shadow-xs`，`ToolHeader`：`lucide:wrench`
+ 中文状态徽章，参数与结果各一块整段 JSON），再叠一层「按输出文本**猜**卡型」的启发式：
`parseCommitOutput` / `parseVitestOutput` / `parseStackOutput` / `parseEnvOutput` /
`parsePackageOutput` / `parseSchemaOutput` / `parseSnippetOutput` 七种。一次回答里出现 6–8 张
带徽章的卡片，是对话区最主要的视觉噪音；而真正有信息量的三处渲染（写文件的 diff、命令的终端输出、
目录列举的文件树）被同一套重卡片稀释了。

现在：

| 形态 | 实现 | 口径 |
| --- | --- | --- |
| 默认 | `ToolFallback`（`tool-fallback.aui.tsx`） | 一行 `Used tool: <label>` + 耗时 + 展开三角；展开才是参数（`Args`）与结果（`CodeBlock` / `Result`）。`tool-card-body.tsx::ToolCardFallbackBody` |
| `write` | `WriteToolCard` + `CodeDiff` | 头部就是「文件名 + `+N −M` + 右侧动作」一行，无 wrench、无状态徽章；**改动正文默认折叠**（折叠时正文不挂载，点标题栏左侧 chevron 展开，与命令卡同款约定）；缺 `before/after` 时退回 `ToolFallback` 明细 |
| `command` | `ToolCardTerminalBody` | `$ 命令` 一行折叠 + 展开终端正文（保留），状态用行内图标而不是徽章 |
| 目录列举 | `file-tree.tsx` | 只出现在 `ToolFallback` 的明细里，不再单独成卡 |
| 追问 / elicitation | `QuestionPrompt` / `Actions` | 当作对话流里的「提问卡」，不套工具外壳 |

**删减范围**（本轮真正下线的代码）：`tool-card-special-body.tsx` 整个文件删除；
`parse-tool-result.ts` 的七个 `parse*Output` 与 `ParsedCommit` / `ParsedTestSummary` /
`ParsedEnvEntry` / `ParsedPackageInfo` / `ParsedSchemaDisplay` 等类型一并删除，
`ParsedToolSpecial` 收窄成 `{ kind: 'tree' }`；`tool-labels.ts::ToolCardVariant` 同步去掉
`commit|test|stack|package|env|schema|snippet`；`tool.tsx` 的 `Tool` 标 `@deprecated`（对话流不再引入，
只留给非对话场景；`ToolElapsed` 仍被命令卡使用）。

**这是取舍，不是遗漏**：删掉七种卡之后，测试通过数、commit 摘要、API 参数表这类「一眼可读」
确实没了，改为「通用行 + 展开原文」。判断依据是：正则猜错时（把普通日志当 vitest 摘要、
把缩进列表当 stack）比通用文本更难读，而猜对的场景只要展开一层也能读到。

**后续方向：按 tool 名注册渲染器。** assistant-ui 的正解是 `makeAssistantToolUI({ toolName }, render)`
逐个工具注册，本仓 `packages/design` 已有 `*.aui.tsx` 适配层惯例（见文末「约定」）。本轮没做，
原因是几十个工具要逐个写渲染器，收益是渐进的；先把「一个外壳」落到所有工具上，再按实际使用频率
把 `read` / `search` / `browser_*` 等迁过去。

## reviewable-diff（按块审阅写文件）

元素本体同样是收费产物，按 elements/reviewable-diff 页渲染出的 DOM 自写（`packages/design/src/assistant/reviewable-diff.tsx`）：
`filename` + 每块 `@@ -a,b +c,d @@` 范围 + Keep / Discard + 尾部「N left to review / All reviewed」+ Apply。
**计数永远由 `hunks[].decision` 现算**（不另存 kept / pending），三个回调（`onKeep` / `onDiscard` / `onUndo`）
传了哪个才渲染哪个控件，都不传就是纯静态卡片（只出标签）。

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 切块 | `views/agent/chat/components/write-review.ts::parseWriteReview` | 按 git 风格取上下文 3 行，相邻 / 重叠窗口并块；range 用 `@@` 标记；`id = hunk-<start>-<end>` |
| 入口 | `tool-card-read-write.tsx`（`CodeDiff` 右侧「审阅」） | 仅 `status === 'complete'` 且非 error 时出现 |
| 决定 | 同上（`decisions: Record<id, HunkDecision>`） | pending 在合成正文时按 **kept** 处理（宁可多留，不误丢） |
| 落盘 | `write-review.ts::rebuildReviewedText` | kept/pending 走 after 侧，discarded 退回 before 侧，块外上下文原样；换行风格跟随原文（CRLF 保持 CRLF），结尾换行不 trim |

**三道落盘闸**：

1. 只对「整文件 before / after」开放；片段级改动（`old_string` / `new_string`）拒绝——否则会把整文件写成片段。
2. 打开审阅前读磁盘，`isSameText(current, review.after)` 不成立就拒（「片段级改动」/「写入后文件又变了」两种文案分开）。
3. Apply 前再读一次磁盘，变了就要求重新打开审阅。

`parseWriteTexts`（`parse-tool-result.ts`）故意**不 trim**——写回文件要保留首行缩进与结尾换行；
渲染 diff 用的 `firstString` 仍然 trim。

**已知限制**：审阅态只在内存里（关卡片即丢）；一次只审一次写入，不给「跨多次写入合并审阅」；
块粒度是「上下文 ±3 行」的窗口，改一行长函数会带出较多上下文行。



1. **context-breakdown**：适配器在每次请求前算一次分段 token（系统提示 / 工具结果 / 附件 / 历史），
   配合「上下文快满」提示能直接减少截断。
2. **mcp-server-panel**：扩展页已有扩展清单，补「连接状态 + 工具开关」即可复用 `panel.tsx`。
3. **checkpoint-history**：需要先把每轮的 `bumpWorkspaceRevision` + 文件快照落盘，属独立特性。
4. **logos**：低优先，随模型选择器一起补。

## 约定

- 所有可见文案走 `assistant/labels.tsx`（`useAssistantLabels`），组件里不写死中文。
- 新接入元素一律做 `*.aui.tsx` 适配层（`makeAssistant*UI`），不要在业务组件里直接用 primitives。
