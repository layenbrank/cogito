# assistant-ui 元素接入现状（Agent 体验）

对照 <https://www.assistant-ui.com/elements> 的元素清单，盘点本仓
`@cogito/design/assistant/*` 的落地情况。**设计包基本齐全**，缺的是「数据源」和「接线」。

> 2026-11-02 更正：上一版把 message-queue 记成「未接入」是**错的**——当时只 grep 了
> `apps/client`，而队列的大头在 `packages/design`（`composer-queue.aui.tsx` + `thread.aui.tsx`）。
> 教训：盘点要同时搜 `apps/` 与 `packages/`。

| 元素 | 设计包实现 | 接入情况 | 说明 / 下一步 |
| --- | --- | --- | --- |
| agent-plan | `agent-plan.tsx`、`agent-plan-state.ts`（另有可折叠外壳 `plan.tsx`、三态清单 `task.tsx` / `todo-list.tsx`） | ✅ | client 对话区：ACP `plan` 事件画成「标题 + `2 / 5` + 3px 进度条 + 每步状态图标」的速览卡（`plan-data-ui.tsx`）；右栏全量计划仍是 `aside-plan.tsx`。见下节 |
| background-inbox | `background-inbox.aui.tsx` | ✅ | `use-background-runs.ts` + `aside-busy.tsx`：后台会话/后台任务的收件箱 |
| schedule-card | `schedule-card.aui.tsx` | ✅ | `plan-schedule-card.tsx`（计划里「定时执行」的那张卡） |
| composer-context | `composer-trigger.tsx` | ✅ | `composer-knowledge.tsx`（知识库引用）/ `extensions-pane.tsx`（右栏「扩展」页签）/ `workspace-file-picker.tsx`（@ 引用、工作区文件）。输入区 `+` 面板 2026-11-06 已拆除，见 [agent-composer-aside.md](./agent-composer-aside.md) |
| terminal-block | `terminal.tsx` | ✅ | `tool-card-terminal-body.tsx` + `features/terminal`（右栏常驻终端） |
| job-progress | `job-progress.tsx`、`job-progress-state.ts` | ✅ | client 对话区：命令类工具卡在「后台命令 / 前台已跑 ≥ 20s」时换成这张卡（`tool-card-job.tsx`）。见下节 |
| tool-timeline | `tool-timeline.tsx`、`tool-timeline-state.ts`、`tool-group.aui.tsx` | ✅ | 动词 + 芯片 + 文件统计的紧凑流水（按元素页自写，步骤由宿主映射）。client 对话流按块渲染（思考一段一条、工具一件一行），不挂这条紧凑清单，见下节「过程区」 |
| file-tree | `file-change-tree.tsx`、`file-change-tree-state.ts`（交互目录树另有 `file-tree.tsx`） | ✅ | client 对话区：回合结束后在**回答下面**挂一张「4 files changed + 目录缩进 + 每文件 `+N −M`」的小结（`ThreadComponents.RunSummary`）。见下节 |
| ~~run-activity~~ | 已下线（总折叠改走 `ProcessGroup` 外壳；纯函数层改名为 `process-state.ts`） | — | 旧实现把过程摊成一条时间线，内层块没法各自折叠。现在两层：外层「过程 · N 步」+ 内层逐块折叠，见下节「过程区」 |
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
| 条目 | `field` 表面 + `rounded-2xl py-2` + `QUEUE_ROW_PAD_CLASS`（`pl-3 pr-2`）、`rowEnter` 入场；序号 `mono w-3 tabular-nums`；正文走 `ComposerChipText singleLine`（多行摊平成一行再 `truncate`，chip 限宽 `9rem`），行高固定 `py-2 leading-5`；正文多于一行时右端出现 `⏎ N 行`（`labels.queueLines`），`title` 保留全文 |
| 行内动作 | 上箭头（`lucide:arrow-up`，`text-foreground/25 size-3`）= 插队；`lucide:x` `size-3.5` = 移除，按钮 `ghostButton size-6`，无障碍文案带正文（`labels.queueRemoveItem(text)`） |
| 展开体 | `max-h-[min(11rem,32vh)]` + 滚动（官方示例永远展开，会顶掉半个屏幕，这里默认折叠）；折叠头同样走单行预览 + 行数标记 |

`extraCount` / `extraPreview` / `renderText` / `renderItemActions` 四个注入点留给 app：`@chip` 标签、
「取回编辑 / 上移 / 下移」这些库没给 primitive 的操作。

**行内留白只有一个来源**（`QUEUE_ROOT_PAD_CLASS` / `QUEUE_ROW_PAD_CLASS`）。这一块有三层带底色的东西
—— 折叠头的 hover 底、每条排队消息的 `field` 底、app 的「待发送」条目 —— 各自加 `px` 的结果是
头与行的背景左边界不齐、文字左边界差 12px、小标题又单独一个数。现在的口径：

- 容器 `px-2`（8px）：所有背景矩形统一内缩，圆角不贴输入框的边；
- 头 / 条目 / 待发送标题再各给 `pl-3 pr-2`（左 12 右 8）：于是**底色矩形的左右边界完全一致，
  文字第一笔都落在 20px**；
- 右侧那 8px 是给行尾的 `size-6` 图标按钮留的，加宽它之前先看按钮会不会被圆角压到；
- 不要拿输入框正文（`px-1`，4px）当基准：队列是嵌在输入框里的**面板**，整体比正文内缩一档，
  它对齐的是「自己这三层的边线」，不是输入框那行字。

改这一块的样式时**先数这三层**，别再往单层补 `px` —— 补一层就是又一条不对齐的边线。

### 持久化（2026-11-06 落地）

原来那句「队列是内存态，刷新即丢」已经解决，实现全在
`apps/client/src/features/agent/composer-queue.ts`：

| 环节 | 口径 |
| --- | --- |
| 落库 | 订阅 `composer.queue`，debounce 300ms 后按 `sessionID` **整队替换**（`agentComposerQueue:toReplace`，事务内先删后插）。整队写而不是逐条 diff：顺序才是队列的语义 |
| 回灌 | `reconcileComposerQueue` 在会话就绪时读一次：会话**仍在跑** → 逐条 `setText` + `send({ steer:false })` 还原成真实队列（`steer:false` 让它们落 `queue` lane，而不是插队）；会话**已结束** → 进 `pending` store，渲染成「待发送」条 |
| 自走泵 | 每轮结束 `pumpPendingQueue` 发队首一条；线程真跑起来后由 `markThreadRunning` 放行下一条 |
| 去重 | `reconciledSessions` 挡重挂载、`inflightReconcile` 挡并发（StrictMode 双跑）：一个会话只回灌一次 |

### 「插队 / 调整顺序」为什么曾经完全失效（2026-11-06 修）

内核把队列分成两条 lane：`queue`（按序）与 `steer`（下一条优先）。
`local-thread-runtime-core::append()` 的判定是
`message.steer ?? this._queueRunInFlight !== null` —— **有 run 在飞时新消息一律进 `steer` lane**；
而 `default-thread-composer-runtime-core::queue` 把两条 lane 拼成 `[...steer, ...queue]`
一个**扁平数组**，前端看不出归属。

`move(queueItemId, placement)` 要求**锚点与目的一条 lane**，不在同一条就抛
`Unknown anchor "…" in lane "…"`。app 侧的上移 / 下移原来把 lane 写死成 `'queue'`：
运行中排队的消息全在 `steer` lane，于是点一下就是一次未捕获异常，按钮看起来「点了没反应」——
这就是「无法插队、无法调序」的根因。

现在的做法（`views/agent/chat/components/composer-queue.tsx::moveQueueItem`）：

1. 先**不指定 lane**，让内核按条目自己的 lane 解析锚点；
2. 被拒再显式试 `steer` / `queue`：锚点只存在于它自己那条 lane，第二轮一定命中；
3. 三次都失败才 `toast.error` 报出来，不再静默失败。

顺带记一条内核行为，免得再按「必须打断当前轮」去设计交互：`steerQueueItem` 的实现是
`move(id, { lane:'steer', insertAfter:null })`，而「打断当前轮立即派发」的分支要求
`insertAfter` / `insertBefore` **都是 `undefined`** —— 官方这条路只是**把条目挪到 steer 队首**
（下一轮先发）。真打断还需要 runtime 给队列 driver 提供 `cancel`，而
`useLocalRuntime` 的 `createMessageQueue({ run })` **没有传 `cancel`**：
本仓的「立即发送」= 排到最前，不中断当前轮。这是库的限制，不是接线漏了。

### 为什么当初没做持久化（历史记录，已落地）

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
| 默认 | `ToolFallback`（`tool-fallback.aui.tsx`） | 一行「状态色块 + `Used tool: <label>` + 参数摘要 + 耗时 + 展开三角」（淡底 + 细边框，见下节）；展开才是参数（`Args`）与结果（`CodeBlock` / `Result`）。`tool-card-body.tsx::ToolCardFallbackBody` |
| `write` | `WriteToolCard` + `CodeDiff` | 头部就是「文件名 + `+N −M` + 右侧动作」一行，无 wrench、无状态徽章；**改动正文默认折叠**（折叠时正文不挂载，点标题栏左侧 chevron 展开，与命令卡同款约定）；缺 `before/after` 时退回 `ToolFallback` 明细 |
| `command` | `ToolCardTerminalBody` | 按耗时分两形态：普通前台命令 `$ 命令` 一行折叠 + 展开终端正文（状态用行内图标而不是徽章）；后台命令或已跑 ≥ 20s 升级成 `job-progress` 收据卡（`tool-card-job.tsx`），原始输出折在卡下 |
| 目录列举 | `file-tree.tsx` | 只出现在 `ToolFallback` 的明细里，不再单独成卡 |
| 追问 / elicitation | `QuestionPrompt` / `Actions` | 当作对话流里的「提问卡」，不套工具外壳 |

**文案全部走 labels。** `tool-fallback.aui.tsx` 里不留可见英文硬编码：`Used tool:` / `Cancelled tool:`
（`toolUsed` / `toolCancelled`）、`Result:` / `Error:` / `Cancelled reason:`（`toolResult` / `toolError` /
`toolCancelledReason`）、审批四键（`toolApprove` / `toolAllowAlways` / `toolDeny` / `toolDenyAlways`）、
二次确认的 `toolConfirm` / `toolBack`、答复按钮与两个占位符（`toolAnswerSend` / `toolAnswerLabel` /
`toolNoteLabel` / `toolAnswerPlaceholder` / `toolNotePlaceholder`），以及写回结果的回执
`toolApprovedResult` / `toolDeniedResult`。`approvalOptionLabel(option, labels)` 仍然让宿主给的
`option.label` 优先 —— 有自定义文案时以工具自己的声明为准。中文覆盖在
`apps/client/src/views/agent/chat/labels.ts`。

**折叠行的高度是常数（28px / `h-7`）。** 一次回答里常有几十次工具调用，行高靠 `py` + 行高
「凑」出来时，只要某一行多带一点内边距就会参差不齐。常数只有一个源：
`packages/design/src/assistant/tool-row.ts` 的 `TOOL_ROW_HEIGHT_CLASS`（`h-7`）与
`TOOL_ROW_HEIGHT_PX`（28），三处折叠行都引用它——

| 折叠行 | 位置 | 口径 |
| --- | --- | --- |
| 通用工具行 | `tool-fallback.aui.tsx::toolTriggerClassName()` | `TOOL_TRIGGER_ROW_CLASS` 就是该常量；helper 是唯一出口，宿主追加 `className` 也顶不掉它（tailwind-merge 只覆盖宽度这类同族声明）；`className` 走 base-ui 的函数形式时也照旧套这层 |
| 命令卡 `$ 命令` 行 | `tool-card-terminal-body.tsx::ToolCardCommandRow` | 曾用 `h-6`（24px），与通用行差 4px；现与通用行同值 |
| 写文件卡标题栏 | `code-diff.tsx`（`data-slot="code-diff-header"`） | 文件名 / `+N −M` / 次级说明 / 右侧动作挤在**同一行**（次级说明不再另起一行，否则行高立刻 40px+） |

单测锁的是常量与这三处引用（`tool-row.test.ts`、`tool-fallback.test.tsx`、`code-diff.test.tsx`、
client `tool-card-terminal-body.test.tsx`），不是某个 class 的散落副本。

**折叠行不再是「一行灰字」。** 最初收敛成 `ToolFallback` 时，折叠态就是 muted 色的
`Used tool: <label>` + 耗时——和正文同一个视觉层级，一次回合几十条时会被当正文读过去
（用户原话：「类似了纯文本的样式，很容易就忽略了」）。现在这一行有四个可感知的层次，
但都不越过「安静」这条线：

| 层次 | 做法 | 理由 |
| --- | --- | --- |
| 状态色块 | 图标套 18px 圆角方块，按状态淡染：运行中 `primary`、完成 `success`、出错 `destructive`、待审批 `warning`、**取消退回中性灰**（取消不是失败） | 成排灰字里唯一带色的锚点；颜色只走 token，深浅主题各自成立 |
| 工具名 | `text-foreground font-medium`，前缀 `Used tool:` 仍为 muted | 名字是这一行真正要读的东西，前缀只是语法 |
| 参数摘要 | `ToolFallback.Trigger` 的 `detail` 插槽（`text-xs` muted、单行裁剪） | 十几次 `read` 全叫「读取文件」，靠路径/命令/查询词才分得清是哪一步 |
| 表面 | `border-border/70 bg-muted/50 rounded-md`，hover 到 `/80`、展开态 `bg-muted/70` | 有边界才像「一条记录」；底色只提一档，几十张深灰块就是新噪音（浅色主题 `--muted` 是 0.963，打三折等于看不见） |

行高仍是 `TOOL_ROW_HEIGHT_CLASS`（28px）常数，色块与摘要都在这一行里排布，不新增第二行。

**摘要的取值口径在 app 侧**：`apps/client/src/features/agent/tool-call-summary.ts::toolCallSummary()`
按 `SUMMARY_KEYS`（`path` / `command` / `query` / `url` / `pattern` …）取第一个命中的字符串，
压成单行并裁到 72 字符；取不到就返回 `undefined`，折叠行退回「只有工具名」，不留空占位。
设计包不解析工具实参（那是宿主的语义），只提供 `detail` 插槽。

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

## job-progress（分钟级任务的收据卡）

元素本体收费，结构 / 行为 / 无障碍属性按官网渲染出的 DOM 与 `.md` 自写：
`packages/design/src/assistant/job-progress.tsx`（外壳）+ `job-progress-state.ts`（纯函数）。
**和 `agent-plan.tsx` 的区别**：agent-plan 讲「清单走到第几步」，进度按**步数**等分；
本元素讲「一件任务的阶段推进」，每阶段有 `weight`，进度按**权重**加权，而且结算时的
`outcome` 会压过数字进度（收据优先于条）。

| 部位 | 行为 |
| --- | --- |
| 抬头的等宽槽 | 运行中显示 `eta`（空则退回「运行中」）；收据态有 `elapsedMs` 就渲染成 `<time datetime="PT72S">1m 12s</time>`，没有就退回状态词 |
| 进度条 | 3px→本仓 `h-1`，`role="progressbar"`，`aria-valuenow` 是加权百分比；权重全零 / 空阶段表退回**等权**（否则 `NaN%`） |
| `stageIndex` | 向下取整并钳进 `0…stages.length`；等于长度且没有 `outcome` = 成功跑完 |
| `stageProgress` | 钳进 `0…1`，只贡献**当前阶段**那一段的加权份额 |
| `outcome` | `success` 绿勾 + `done` + 条拉满 100%；`partial` 琥珀 / `failed` 红 / `cancelled` 灰圈斜杠 —— 这三种**保持条停在真正到达的位置**，`aria-valuenow` 也不改；收据态一律移除取消按钮 |
| 阶段标签 | 每阶段一个 `mono` 标签；只有**当前阶段**的 `description` 显示在标签行下方 |
| 读屏 | `role="status"` 的 sr-only：运行中播报「当前阶段」，收据态播报最终结论；`data-state` = `running` / `partial` / `failed` / `success` / `cancelled` |

**client 挂载点（2026-11 定）**：`tool-card-terminal-body.tsx`，按「这件事要花多久」分两种形态 ——
普通前台命令（几秒就完）保持一行 `$ 命令` + 状态 + 耗时 + 展开终端；后台命令
（`args.background === true`）或前台已跑 `JOB_COMMAND_THRESHOLD_MS = 20_000` 则升级成
`tool-card-job.tsx`：`title` 是命令、`stages` 只有一段（`labels.jobStageCommand`，`description` 放工作目录）、
`stageIndex = isRunning ? 0 : 1`、`outcome` 由 `isError` 映射成 `success` / `failed`、`elapsedMs` 取
`useToolCallElapsed()`；原始输出不丢，折在卡下面那条「输出」里（点开仍是 `Terminal`）。
**不给取消按钮**：ACP 没有「取消单个工具调用」的接口，给个按不动的按钮比不给更糟。

理由：这是仓库里唯一「分钟级、有明确起止、跑完要留回执」的工具类别；判定与结局映射放在
`components/tool-card-job-state.ts`（`isJobCommand` / `findCommandStageIndex` / `findCommandOutcome`），
卡片只负责画。纯函数单测 5 例（`tool-card-job-state.test.ts`）、静态渲染 12 例
（`job-progress.test.tsx`）+ 挂载点 3 例（`tool-card-terminal-body.test.tsx`）。

## tool-timeline（一轮干过的事收成一行）

元素本体是收费产物，结构 / 行为按官网渲染出的 DOM 自写：
`packages/design/src/assistant/tool-timeline.tsx`（外壳）+ `tool-timeline-state.ts`（可见步数钳制 + 文案）。
**数据由宿主映射**（元素页口径：库不猜工具名）：client 的映射在
`views/agent/chat/components/tool-timeline.tsx`（动词走 `labels.timelineVerb`、芯片取参数里的
路径 / 命令 / 查询词、文件改动从写工具的 before/after 现算 `+N −M`）。

| 部位 | 行为 |
| --- | --- |
| 折叠条 | 跑完是 `restingLabel`（`4 步 · 2 个文件改动`），在跑是 `activeLabel`（`工作中`）；两条标签**叠在同一格里交叉淡入**，容器宽度跟着当前那条走（元素页的宽度动画就是这么来的） |
| 行 | 每步 `图标 + 动词 + 芯片`（芯片 mono `text-xs`）；只有**最后露出的那一步**在跑时闪，前面的步算落地 |
| `visibleSteps` | 向下取整并钳进 `0…steps.length` —— 「步骤已产生但还没露头」是合法状态 |
| 文件统计 | 整排只在 `stats` 非空时出现；某条缺 `added` / `removed` 就少写那一半，不补 0 |
| 相同芯片 | 两条芯片一样也是两行（按 `id` 区分，不合并） |

**和过程区的分工**：run-activity 已下线（整轮时间线改成「总折叠 + 子折叠」，见「过程区」），
对话流里不再有整轮时间线；tool-timeline 是「只描述做了什么」的紧凑清单，与过程区的逐块折叠不叠同一位。
否则一轮会出现两条折叠条。当前 client 只在适配层准备好了数据映射（`AgentToolTimeline`），
**没有挂进消息流**——要挂的话先决定用哪条路径。

## file-tree（改动文件树）

元素本体收费，结构 / 行为按官网渲染出的 DOM 自写：
`packages/design/src/assistant/file-change-tree.tsx`（外壳）+ `file-change-tree-state.ts`（扁平改动 → 节点 / 汇总 / 可见行钳制）。
名字上刻意避开 `file-tree.tsx` —— 那是另一套东西：目录列举用的**交互**树
（`FileTree` / `FileTreeFolder` / `FileTreeFile`，可折叠可选中），只出现在工具明细里；
这里的数据是扁平的增删列表、没有交互，两者不要混用。

那套交互树虽然结构自己写，**槽位名与元素页对齐**：`data-slot="file-tree"` / `file-tree-folder` /
`file-tree-file` / `file-tree-name` / `file-tree-icon` / `file-tree-actions`。两条理由：面板与测试
按 `[data-slot="file-tree"]` 写选择器时与官网同一套；根节点**不再自带 `rounded-lg border`** ——
它只出现在 `ToolFallback` 的明细里，外壳已经有边框，再来一层就是「卡里套卡」。

| 部位 | 行为 |
| --- | --- |
| 表头 | 左 `N files changed`（只数 `kind: 'file'`，目录表头不算文件），右 `+78 −9`。净增删**永远渲染**，`+0 −0` 也写 —— 表头回答的是「一共改了多少」 |
| 目录行 | **静态**：不是真父节点、不可折叠、点不动（元素页口径），chevron 只是「已展开」的标记 |
| 文件行 | 缩进 `depth × 0.85rem`，用 `padding-inline-start`（RTL 自动翻边）；增删缺一半就不写那一半，`0` 等于没有，不补 0 |
| `visibleCount` | 露出前几行，向下取整钳进 `0…nodes.length`（与 `visibleSteps` 同一套规则）；表头仍按全量统计 |
| 目录层级 | 只分一层：`packages/core/src/a.ts` 的表头就是整条 `packages/core/src`，不拆三级 |
| 同一文件改两次 | 合成一行、增删相加 —— 这里答的是「一共动了哪些文件」，不是「工具调用了几次」 |

**和官方示例 `buildFileTree` 的一处刻意不同**：示例按「第一次见到的目录」插表头、
之后照输入顺序继续 push，目录交错时（`a/x`、`b/y`、`a/z`）第三行会落到 `b` 的块里 —— 位置错了。
本仓按目录分组（目录顺序 = 首次出现顺序），同一目录的文件始终挨在一起。

数据侧：`views/agent/chat/components/file-changes.ts::collectFileChanges` 从写入工具的
before/after 现算增删（只认整文件写入，片段级不给假数），`AgentFileChangeTree` 再交给
`buildChangeNodes` 分组 —— 与 `AgentToolTimeline` 共用同一份增删读取逻辑（那个要基名，这个要整条路径）。

**挂在哪**：`ThreadComponents.RunSummary`（design 侧「回合小结」槽）→ `AgentFileChangeTree`。

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 时机 | `thread.aui.tsx::AssistantMessage` | 只在回合**结束**时渲染：`running` 与 `requires-action` 都不算结束 —— 流式中途挂上去会跟着每次写入闪变（文件先出现、数字再跳），等审批时也不是「这一轮干了什么」的结论 |
| 位置 | 同上 | 排在**最终回答之后**，带 `mt-3` 与正文拉开；在过程区尾注 / `MessageError` / 回合尾注之前 |
| 内容 | `views/agent/chat/components/file-change-tree.tsx` | 宿主自己算：没有写文件就返回 `null`，那一轮不留空壳；库只传 `parts` 与结束状态，不猜工具语义 |
| 不冲突 | — | 过程是一块一块各自折叠的（思考一段一条、工具一件一行），这张卡摊的是**结果**（一共改了哪些文件），不进任何折叠 |

纯函数单测 12 例（`file-change-tree-state.test.ts`），静态渲染 7 例（`file-change-tree.test.tsx`）。
`labels.filesChanged` 与 tool-timeline 折叠条共用一条文案（原来叫 `timelineFilesChanged`，本轮改名 —— 它不再只属于时间线）。

## agent-plan（模型正在按清单干活）

元素本体收费，结构 / 行为 / 无障碍属性按官网渲染出的 DOM 自写：
`packages/design/src/assistant/agent-plan.tsx`（外壳）+ `agent-plan-state.ts`（纯函数）。
**和 `plan.tsx` / `task.tsx` / `todo-list.tsx` 不是一回事**：那三个是可折叠 Card 外壳、
或吃「每步自带 status」的三态清单；本元素不折叠，且**只有单个 `activeIndex`**。

| 部位 | 行为 |
| --- | --- |
| 三态怎么来 | 不是三份数据：`index < clamped` 或全部完成 → done；`=== clamped` → active；其余 ahead。所以「已完成但排在待办之后」无法表达 |
| `activeIndex` | 钳进 `0…steps.length`（`NaN` → 0）；越界 = 全部完成，此时**没有 active 步**、进度条 100% |
| 进度条 | 3px，`role="progressbar"`；`aria-valuenow` 是百分比、`aria-valuetext` 是「几步 / 共几步」，`aria-label` 优先用标题（没有标题退回「计划进度」）。宽度动画 500ms（比聊天里其它动效慢，数字跳变才不抖），`instant` 可跳过 |
| 步 | 字符串只带标签；对象可带 `id`（稳定 key）+ `description`（**只在 active 那一步显示**）。每行都带 `sr-only` 状态词，视觉上是 对勾 / 转圈 / 圆点 |
| 空列表 | `0 of 0`、0%、一步都不渲染（不留空壳） |
| 重跑 | 没有单独的 reset：再来一次 `update_plan`（`activeIndex` 回到 0）就重头走 |
| `idle` | **元素页没有**：计划还没开始（右栏读草稿）时传 `idle`，每步都是「还没到」的圆点、进度 0、`data-status="idle"` —— 比让第一步假转圈诚实 |
| 折叠壳 | **元素页没有这个能力**，本仓加的：给了 `collapseAfter` 且步数超过它时，默认只留「表头 + 进度条 + 正在做的那一行」，其余折起来；`defaultOpen` 可直接展开。开关是表头右端的 ghost 按钮（`aria-expanded` + `aria-controls`，文案走 `labels.planExpand(total)` / `planCollapse`）。不给这个 prop 时渲染与元素页逐字一致 |

**为什么加折叠**：计划一长，整段清单铺在消息里会把回答顶出屏幕。对话里的卡只负责
「一眼看到进度」（标题 / `2 / 8` / 进度条 / 正在做的那一步），**全量计划交给右栏的计划页签**
（`aside-plan.tsx`：草稿正文、目标推进、保存与执行）。client 传的是 `collapseAfter={5}`。

**右栏用的是同一张卡的不折叠版**（`aside-plan.tsx`）：外面套一层 `border-border/60` 的
小卡片，`className="max-w-none"` 让它铺满侧栏，`idle` 表达「草稿还没开始」，下面接一条
分隔线 + **完整 Markdown 正文**（`MarkdownContent`，标题字号压到与正文接近，免得一个 `##`
撑满侧栏）。抬头只留标题 / 状态徽标（走 `text-primary` / `text-success` / `bg-warning/20`
这些 token，不再手调 violet / emerald / amber）/ 概述 / 绑定的计划文件；底部操作压成两行：
主操作（开始执行 + 目标推进）一行，保存 / 复制 / 载入 / 标记完成 收成 28px 的图标按钮一行。
ACP 三态 → `activeIndex` 的换算两处共用 `components/plan-steps.ts`，不会出现两个进度。

**接入点**：`views/agent/chat/components/plan-data-ui.tsx`。ACP `plan` 事件给的是
**每步三态**，换算集中在 `toActiveIndex`：有 `in_progress` 取它的下标；没有就停在第一个未完成的；
全完成给 `entries.length`。刻意不引入「每步 status」的第二套渲染路径 —— 元素的可视模型是单调推进的，
乱序事件（已完成排在未完成之后）那一步会显示成「还没到」，这个偏差写进注释而不是另造状态。

右栏 `aside-plan.tsx` 仍然展示**全量计划正文**（草稿 Markdown / 目标推进 / 保存与执行），
和这张速览卡分工不同：一个是「这轮走到哪了」，一个是「计划到底是什么」。

纯函数单测 13 例（`agent-plan-state.test.ts`：钳制 / 归一 / 进度 / 三态 / 文案），
静态渲染 11 例（`agent-plan.test.tsx`，含 3 例折叠壳：未超阈值不出现开关 / 超阈值只留 active 行 /
`defaultOpen` 直接展开；折叠态全完成时只剩表头）。

## 过程区（总折叠 + 子折叠）

**两级折叠，缺一不可。** 过程 = 最终回答之前的一切，它在消息里是「外层总折叠 → 内层每块自己折叠」：

| 层 | 行为 |
| --- | --- |
| 总折叠 | `ThreadComponents.ProcessGroup`（默认 `DefaultProcessGroup`）：一轮一条「过程 · 6 步 · 5 秒」（`labels.process(steps, seconds)`）。**外壳自己管开合**（`userOpen` 三态：`null` 跟着这一轮走 / `true` / `false`）：跑的时候展开、结算后收起，用户点过就以用户为准、不再被自动逻辑改回来。收起它 = 整轮过程收成「一行构成 + 逐步明细」，**最终回答始终在外壳外面** |
| 子折叠 · 思考 | 相邻 reasoning 合成一段一条：默认收起成「思考中… / 已思考 · 最新一句」，点开才挂正文（`ReasoningRoot` + `ReasoningTrigger`）；`streaming` 只负责「展开后跟随最新 token」 |
| 子折叠 · 工具 | 一件一行，卡片自己就是折叠行（`ToolFallback.Root`：工具名 + 参数摘要 + 状态 + 耗时），展开是参数 / 输出 / diff / 终端。**默认不按「N 次工具调用」再分组** —— 那会把这一轮的手脚又收成一条；宿主显式传 `ThreadComponents.ToolGroup` 才会分组 |
| 子折叠 · 解说 | 中间说明文字直接摊开（不折）；最终回答同样常驻可见 |
| 不折叠 · 其它 | plan / file / image / data UI 在原位；待审批与出错的工具卡各自强制展开（按钮与失败原因不能藏在折叠里） |

**外壳不是每轮都套。** 过程只有一行（一次「思考 → 答」）时直接渲染那一块 —— 外面再写一行「过程 · 1 步」是噪音；那块自己就是一条折叠行。
判定按**行**算（`toProcessRows(processRuns) > 1`）：工具一件一行、思考一段一行、解说一行。
按块算会把「连续 5 次工具调用」写成「1 步」，与展开后看到的五行对不上；`labels.process(steps)` 里的 `steps` 就是行数。

**收起态仍然要说得出「刚才走了哪几步」。** 只有「过程 · 6 步 · 5 秒」等于逼用户展开才知道干了什么，而展开一轮几十步又回不到结论。所以外壳收起时：

- 下面列**逐步明细**（`ProcessOutline`，`data-slot="aui_assistant-process-outline"`，点一下展开）：工具一件一条（`labels.timelineVerb` + 参数摘要）、思考一段一条（`已思考 · 最新一句`）、解说一块一条（首行）；
- 明细最多 5 条（`PROCESS_SUMMARY_LINES`）：结算后从第一步往后列，跑的时候列**最近** 5 条（收起态多半想看「现在走到哪」），超出折成「还有 N 步」（`labels.processMore`）；
- **同一件事只说一遍**：清单列得全（≤5 条）时折叠行不再报步数、也不给构成行；只有清单被截断时才在行尾补构成行（`labels.processDetail`：`4 次工具 · 1 段思考 · 2 段说明`）—— 工具 + 思考 + 说明正好是步数，两个数字并排写等于说两遍。跑的时候折叠行那一格是**当前那一步**（`思考中… · 最新一句` —— 思考块进行中不许用「已思考」），且这时候收起行不再复述清单最后一行；
- **展开后明细整块消失** —— 同一信息由各块自己的折叠条承担，不摆两遍。

明细由 `toProcessDigest(parts, runs)` 现算：工具参数只认 `path / file_path / command / pattern / query / url` 这类字段，取第一个命中的字符串（`toToolArgDetail`，压成一行、截 48 字）；思考取最后一行；解说取首行；
file / image / 自定义 data UI 这种没有一行可写的块不列（展开后原位就在），工具缺名字时只计数、不列条目。
外壳 props 相对上一版多了一个可选 `summary`：宿主自己实现 `ProcessGroup` 时拿到同一份 `{ detail, lines, hidden }`，不用再扫一遍 parts；不传就退回只有一行文案。
`detail` 不是总有：清单列得全时为空（避免重复报数），跑着时是「当前这一步」，清单被截断时才是构成行。

边界是**算出来的**：`findResponseStart` 从末尾倒找最后一段非空正文，之前的都算过程。
外壳标签上的秒数取 `message.metadata.timing.totalStreamTime`，只在结算后写（跑的时候每帧都在跳，标签会像秒表一样闪），最少 1 秒。

**自动收起晚一帧，且先钉滚动。** 结算时先钉一个等高 spacer（`useCollapseScrollPin`），再由下一帧（`useLayoutEffect`）塌陷收高：同一 commit 里收起来，面板高度已经归零、量不到东西，贴底读回答的人会看到正文被顶上跳一截。判定「还在跑」只看 `message.status.type === 'running'`；等审批（`requires-action`）不算在跑（不转圈、不写秒数），但外壳**保持展开**（`attention`）：
允许 / 拒绝按钮是必须点到的，自动收起等于把它藏进折叠里；用户手动收过仍以用户为准。

宿主指标（首字 / 速度 / token）走 `ThreadComponents.ProcessFooter`，client 挂 `MessageTimingStats`；
它排在过程区**最末**：套外壳时在外壳内容里、跟着一起收起；过程只有一块时直接跟在那一块后面（没外壳也照样给指标）；过程为空（直接一段回答）时不出，那些数字只会变成回答头顶多出来的一行。

**为什么要外层。** 一轮几十步时，只留子折叠仍会把「这一轮一共做了什么」摊满一屏；收成一条「过程 · 6 步」才是回看时的入口。
**为什么要内层。** 只留外层能读的只有「构成 + 几条灰字明细」：工具卡点不开、输出 / diff / 终端都拿不到，要看细节还得在一整条时间线里重新找。
两层各管一段：外层管「要不要看」，内层管「看哪一步」。

`packages/design/src/assistant/run-activity.tsx`（一轮一条、把过程摊成时间线的旧实现）与它的单测已删除；纯函数层改名为 `process-state.ts`：
切块（`findResponseStart` / `toProcessRuns` / `toRunStatus` / `toRunCounts`）+ 文案（`formatRunDuration` / `toThinkingHint` / `toRunActivityStatus`），
单测 `process-state.test.ts`（35 例：结论边界、相邻思考合并、工具各自成段、时长与思考摘要，以及行数口径 `toProcessRows`、参数摘要 `toToolArgDetail`、收起明细 `toProcessDigest`）；外壳那层另有 `thread-process.test.tsx`（9 例：两级挂点都在、跑时展开、结算收起、秒数只写在行尾，以及收起有明细 / 展开让位 / 超限尾巴 / 不传 `summary` 的退回 / 等审批不收起）。

**折叠行必须说得出「具体在干什么」。** 只有状态词（「思考中…」）等于没说 —— 收起状态用户只看得到这一行。
思考块的 `detail` 由 `toThinkingHint(text)` 现算：取**最后**一行（思考是往后长的，最后一句才是「现在在琢磨什么」），
抹掉 Markdown 记号裁到 40 字；工具卡那一行本来就有参数摘要（`toolCallSummary`）。
`detail` 单独占一格（`min-w-0 truncate`），状态词不被挤掉，整行仍是常数高度。

**文案不许「只剩一个名词」。** 思考段还在跑给「思考中…」（`labels.working`），跑完才是「已思考」（`labels.reasoning()`，
英文 `Thought`）。历史上两边共用一个「思考」，于是模型想完、还没吐第一个字的空档里只剩**「思考」两个字**，
用户以为会话终止；`showIndicator`（末尾 sparkles + 「思考中…」）也只跳过「正在跑的正文」。

**轨迹瀑布图仍不在。** 它把「消息 / 思考 / 工具」画成两层时间轴，信息与过程块重复，还占掉首屏。

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

## 用户气泡：封顶与框内滚动

长用户消息在 `thread.aui.tsx` 的 `UserMessageBody` 里**一律封顶 264px**（`USER_BUBBLE_MAX_HEIGHT_PX`）、超出的部分在框里滚动，**不做展开 / 收起**：高度既然已经限死，那颗开关只会添乱 —— 挂框下沿就得跟着框长高往下跳几百像素（「跳跳来跳去」的根源），挂上沿又反直觉。滚轮 / 触摸在气泡里滑到底就能读完，底部渐隐提示「下面还有」。

- **量法**：直接跟封顶高度比（`max-height` 是常量，`scrollHeight` 就是全文高度）；别比 `clientHeight` —— 没封顶时两者相等，永远量不出溢出。正文长度进依赖，改过的消息重量一次。
- **渐隐只盖气泡**：`aui_user-message-fade` 放在只包住气泡的那层 `relative` 里；滚到底（`scrollTop + clientHeight >= scrollHeight - 1`）就撤掉，否则最后一行永远被那 40px 盖着。
- **会话胶囊的外壳必须常驻**（`thread-user-sticky.aui.tsx`）：贴不贴住是运行时滚出来的状态，靠 `shellRef` 反查 Viewport 才绑得上滚动监听；如果按「已经贴住的那条」提前 `return null`，ref 永远拿不到 → 监听绑不上 → 胶囊再也不会出现。可见性只交给 `isPinned` 的透明度动画。

## 约定

- 所有可见文案走 `assistant/labels.tsx`（`useAssistantLabels`），组件里不写死中文。
- 新接入元素一律做 `*.aui.tsx` 适配层（`makeAssistant*UI`），不要在业务组件里直接用 primitives。
