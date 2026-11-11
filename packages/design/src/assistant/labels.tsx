import { createContext, useContext, useMemo, type FC, type PropsWithChildren } from 'react'

import { findDayLabel } from './thread-day'

/**
 * assistant 组件的界面文案。
 *
 * 库对语言不表态：默认值取英文，由 app 用 `AssistantLabelsProvider` 注入自己的语言。
 * 组件里不再出现任何可见字符串 —— 想加文案就在这里加一条，不要写回组件。
 */
type AssistantLabels = {
  // 会话列表
  newThread: string
  searchThreads: string
  noThreads: string
  loadingThreads: string
  untitledThread: string
  running: string
  renameThread: string
  moreOptions: string
  rename: string
  archive: string
  delete: string

  // 消息区
  welcome: string
  loadingConversation: string
  scrollToBottom: string
  /** 会话左侧的回合刻度尺（assistant-ui conversation-map；同时是它的无障碍名） */
  conversationMap: string
  userMessageLocatorItem: (ordinal: number, total: number) => string
  /** 用户句滚出视口后的浓缩 sticky 条（点击回到该句） */
  userMessageSticky: string
  /** 消息日期分隔条（今天 / 昨天 / 更早的日期） */
  dayLabel: (date: Date) => string
  /** 被用户中断的回合尾注 */
  stoppedRun: string
  /** 正常跑完的回合尾注（只标在最后一条消息上） */
  completedRun: string
  /** 撞长度上限、正文被截断的回合尾注 */
  truncatedRun: string
  /** 内容过滤 / 未知原因中断的回合尾注 */
  interruptedRun: string
  working: string
  copy: string
  reload: string
  more: string
  exportMarkdown: string
  edit: string
  /** 编辑已发送的消息时，发送后从当前分支掉出去的回复条数（`0` 时不显示提示） */
  editDiscardsReplies: (count: number) => string
  cancel: string
  update: string
  previous: string
  next: string
  send: string
  stopGenerating: string
  startDictation: string
  stopDictation: string

  // 输入区
  composerPlaceholder: string
  /** 已有消息时的占位，空会话仍用 composerPlaceholder */
  composerPlaceholderContinue: string
  /** Agent 运行中且支持队列时的占位 */
  composerPlaceholderRunning: string
  /** 输入框禁用时（线程运行中不允许队列 / 只读）的 title 说明 */
  composerDisabledHint: string
  /** 提示词库：搜索框（占位 + 无障碍名） */
  promptLibrarySearch: string
  /** 提示词库：列表的无障碍名 */
  promptLibraryList: string
  /** 提示词库：一条都没有时 */
  promptLibraryEmpty: string
  /** 提示词库：列表右端的变量数（`2 vars` / `2 个变量`） */
  promptLibraryVariables: (count: number) => string
  messageInput: string
  /** 待发送队列标题 */
  queueHeading: string
  queueRemove: string
  /** 单条移除的无障碍文案：带上正文，读屏才知道删的是哪一条 */
  queueRemoveItem: (text: string) => string
  /** 队列标题右端的口径：这些消息等本轮结束后自动发（对齐官方元素的排版） */
  queueSendsWhenFinishes: string
  /** 「正在运行」那行右侧的状态标签 */
  queueRunning: string
  queueSteerNow: string
  /** 运行中点击发送（入队） */
  sendQueued: string
  /** 运行中发送按钮的完整口径：默认入队，按住修饰键插队 */
  sendQueuedHint: string
  /** 输入区上方排队条标题 */
  queuedMessages: (count: number) => string
  /** 队列非空时的口径说明：停止只中断当前轮，队列里的消息稍后照发 */
  queueStopHint: string
  /** 队列折叠态的开关：展开 */
  queueExpand: string
  /** 队列折叠态的开关：收起 */
  queueCollapse: string
  /** 队列条目没有正文时折叠态的占位（只有附件那种） */
  queueEmptyPreview: string
  /** 队列单行预览背后的行数标记（`⏎ 4 行`），只在正文多于一行时出现 */
  queueLines: (count: number) => string
  /** 取回编辑：把这一条搬回输入框 */
  queueTakeBack: string
  queueMoveUp: string
  queueMoveDown: string
  /** 上次没发出去的（会话已结束时回灌的历史队列）标题 */
  queuePendingHeading: (count: number) => string
  /** 历史队列条目：立刻发送这一条 */
  queuePendingSend: string
  /** 历史队列条目：丢弃这一条 */
  queuePendingDrop: string
  /** 失败那一轮的重试按钮 */
  errorRetry: string

  // 部件
  /** 推理折叠条：**跑完之后**的说法（进行中由 trigger 的 active 态配 `working`）；`seconds` 只在有耗时时给出 */
  reasoning: (seconds?: number) => string
  /**
   * 过程折叠条（整轮：思考 + 工具 + 中间解说）：`steps` 是过程占几行（工具一件一行，其余每块一行），
   * `seconds` 只在有耗时时给出。结算后行尾已经接构成行（`processDetail`）时 `steps` 传 `undefined`：
   * 工具 + 思考 + 说明就是步数，两个数字并排写等于同一件事说两遍。
   */
  process: (steps?: number, seconds?: number) => string
  /**
   * 总折叠收起后的构成行：`4 次工具 · 1 段思考 · 2 段说明`。
   * 三项都为 0 时返回空串 —— 外壳不留一个孤零零的分隔点。
   */
  processDetail: (tools: number, thoughts: number, notes: number) => string
  /** 收起态明细清单里「中间解说」那一行的动词 */
  processNote: string
  /** 收起态明细列不下时的尾巴（还有几步没列出来） */
  processMore: (count: number) => string
  /** 工具折叠条：`failed` 只在确实有失败时给出 */
  toolCalls: (count: number, failed?: number) => string

  // 整轮活动流水：run-activity 已下线（过程区改成总折叠 + 子折叠），这几条暂时没有使用者，留着等「整轮一行」的复刻
  /** 折叠条前缀：还在跑、且没有可用的「最近一条活动」 */
  runWorking: string
  /** 折叠条前缀：跑完（后面拼结算时长，如「已工作 4.8s」） */
  runWorked: string
  /** 折叠条前缀：跑完但没有时长可用 */
  runCompleted: string
  /** 折叠条前缀：等人处理（审批 / 补充信息），此时不算跑完 */
  runNeedsAction: string
  /** 折叠条前缀：用户中断（后面拼时长） */
  runStopped: string
  /** 折叠条前缀：失败（后面拼时长） */
  runFailed: string
  /** 折叠条前缀：没跑完但也没报错（截断 / 内容过滤） */
  runIncomplete: string
  /** 运行中折叠条上的「最近一条活动」：这一步是哪个工具 */
  runToolActivity: (toolName: string) => string
  /** 展开态底部的「收起」按钮：一长串流水不用滚回顶部才收得起来 */
  runCollapse: string
  /** 工具时间线的「正在跑」文案（`tool-timeline` 的 activeLabel） */
  timelineWorking: string
  /** 工具时间线折叠条：「4 steps」 */
  timelineSteps: (count: number) => string
  /** 文件改动条数：「2 files changed」（tool-timeline 折叠条与 file-tree 表头共用一条口径） */
  filesChanged: (count: number) => string
  /** 工具时间线每一步的动词（Read / Ran / Edited …）：工具名 → 动词，由这里收口 */
  timelineVerb: (toolName: string) => string

  // 工具卡（tool-fallback）
  /** 普通工具行前缀：`Used tool: <name>` */
  toolUsed: string
  /** 工具行「跑着」的说法：元素页是 `Searching the docs`，中文拼成「正在读取文件」；落地后用工具名本身 */
  toolCallActive: (label: string) => string
  /** 折叠行展开后第一块的标题：原始请求 */
  toolCallRequest: string
  /** 第二块的标题：结果 */
  toolCallResult: string
  /** 被中断/取消的工具行前缀 */
  toolCancelled: string
  /** 展开后结果块的表头 */
  toolResult: string
  /** 失败原因的表头 */
  toolError: string
  /** 被取消原因的表头 */
  toolCancelledReason: string
  /** 审批通过后写回工具结果的回执 */
  toolApprovedResult: string
  /** 拒绝执行后写回工具结果的回执 */
  toolDeniedResult: string
  /** 审批：这一次允许 */
  toolApprove: string
  /** 审批：总是允许 */
  toolAllowAlways: string
  /** 审批：这一次拒绝 */
  toolDeny: string
  /** 审批：总是拒绝 */
  toolDenyAlways: string
  /** 二次确认：确认执行 */
  toolConfirm: string
  /** 二次确认：退回选项 */
  toolBack: string
  /** 提问式请求的答复按钮 */
  toolAnswerSend: string
  /** 提问式请求的输入框无障碍名（没有 prompt 时兜底） */
  toolAnswerLabel: string
  /** 「给这次决定加一句说明」输入框的无障碍名 */
  toolNoteLabel: string
  /** 提问式请求的占位 */
  toolAnswerPlaceholder: string
  /** 决定说明的占位 */
  toolNotePlaceholder: string

  // 计划卡（agent-plan）
  /** 表头右端计数：`5 of 5` */
  planCount: (completed: number, total: number) => string
  /** 进度条的无障碍名称：有标题就用标题（`Composer draft progress`），没有退回通用文案 */
  planProgress: (title?: string) => string
  /** 进度条的读数：`5 of 5 steps` */
  planProgressValue: (completed: number, total: number) => string
  /** 每一步的读屏状态（视觉上是图标：对勾 / 转圈 / 圆点） */
  planStepDone: string
  planStepActive: string
  planStepAhead: string
  /** 表头标题的缺省值（宿主不给 `title` 时用，元素页默认 `Plan`） */
  planTitle: string
  /** 会话里这张卡的标题（`执行计划`）：标题由宿主给，但文案不该写死在组件里 */
  planCardTitle: string
  /** 这张卡已被更新的一版取代：`已被 r3 取代` */
  planSuperseded: (revision: number) => string
  /** 折叠态展开按钮的无障碍名称：`Show all 8 steps` */
  planExpand: (total: number) => string
  /** 展开态收起按钮的无障碍名称 */
  planCollapse: string

  // 任务进度卡（job-progress）
  /** 进度条的无障碍名称：`Verify the fix on CI progress` */
  jobProgress: (title: string) => string
  /** 运行中的状态词（有 ETA 时显示 ETA，它只是兜底） */
  jobRunning: string
  /** 收据态的状态词：成功 */
  jobDone: string
  /** 收据态的状态词：部分完成 */
  jobPartial: string
  /** 收据态的状态词：失败 */
  jobFailed: string
  /** 收据态的状态词：用户取消 */
  jobCancelled: string
  /** 运行中取消按钮的名称（收据态不显示） */
  jobCancel: string
  /** 读屏播报：运行中当前阶段（`Stage build`） */
  jobStageAnnounce: (name: string) => string
  /** 读屏播报：最终收据（`Job partly done`） */
  jobOutcomeAnnounce: (word: string) => string
  /** 阶段名：命令类工具只有一段，就是这条命令本身在跑 */
  jobStageCommand: string
  /** 命令类任务卡下方那条「输出」折叠条 */
  jobCommandOutput: string
  // 联网搜索卡（web-search）：过程本身的一句话 —— 查了什么、读了几条
  /** 检索进行中的状态行 */
  webSearchSearching: string
  /** 跑完的收据：读了 N 条来源 */
  webSearchCount: (count: number) => string
  /** 一条来源都没有 */
  webSearchEmpty: string
  // 检索块（retrieval-chunks）：检索命中了哪几段、每段多相关
  /** 检索进行中的状态行 */
  retrievalRetrieving: string
  /** 跑完的收据：N 段命中 */
  retrievalMatches: (count: number) => string
  /** 一段都没命中 */
  retrievalEmpty: string
  /** 模糊匹配回退的弱标记（没有可信分数） */
  retrievalFuzzy: string
  /** 上面那个标记的 tooltip */
  retrievalFuzzyHint: string
  /** 分数条的无障碍名称 */
  retrievalMeter: (source: string) => string
  // 时间轴卡（timeline）：日历这类「时刻 + 事件」的竖轴
  /** 全天事件在左列写的字（没有具体时刻） */
  timelineAllDay: string
  /** 事件没有标题时的兜底 */
  timelineUntitled: string
  /** 「结束时刻」那段说明的前缀：`至 10:30` */
  timelineUntil: (clock: string) => string
  /** 结果还没到时的状态行 */
  timelineReading: string
  /** 一段时间里一条安排都没有 */
  timelineEmpty: string
  // 审批卡（approval-card）：等人答复 / 执行中 / 完成 / 拒绝
  /** 标题缺省值（宿主没给 `title` 时用） */
  approvalDefaultTitle: string
  /** 副标题缺省值：没有 prompt 时的那句说明 */
  approvalDefaultSubtitle: string
  /** 主按钮：这一次允许 */
  approvalAllowOnce: string
  /** 次级按钮：以后都允许 */
  approvalAlwaysAllow: string
  /** 拒绝 */
  approvalDeny: string
  /** 收据：正在执行 */
  approvalRunning: string
  /** 收据：做完了（元素页默认 `Finished`） */
  approvalDone: string
  /** 收据：被拒绝 */
  approvalDenied: string
  /** 提交时审批已失效的提示（宿主据此让用户重发） */
  approvalStale: string
  /** 排期卡：`next` 那一格的标签 */
  scheduleNext: string
  /** 排期卡：最近执行一组的标题 */
  scheduleRecentRuns: string
  /** 排期卡：停用时代替下次触发的说法（元素页是字面量 `paused`） */
  schedulePaused: string
  /** 排期卡：一次成功 */
  scheduleRunOk: string
  /** 排期卡：一次失败 */
  scheduleRunFailed: string
  /** 排期卡：开关的无障碍名（开着 = 点了会暂停） */
  schedulePause: (name: string) => string
  /** 排期卡：开关的无障碍名（关着 = 点了会恢复） */
  scheduleResume: (name: string) => string
  /** 上下文：面板标题与明细卡标题 */
  contextTitle: string
  /** 环按钮的无障碍名 / tooltip */
  contextUsage: string
  /** 分段 meter 的无障碍名：`<段名> context usage` */
  contextMeterLabel: (label: string) => string
  /** 分段 meter 的数值文案：`1,800 of 128,000` */
  contextMeterValue: (used: string, limit: string) => string
  /** composer 面板的合计行 */
  contextTotal: string
  /** composer 面板三段固定名 */
  contextSystem: string
  contextTools: string
  contextMessages: string
  /** 明细卡里的剩余行（算出来的，不由宿主传） */
  contextHeadroom: string

  /** 明细卡的附件段 */
  contextAttachments: string

  /** 设置卡：模型那一段的小标题 */
  settingsModel: string
  /** 设置卡：提示词那一段的小标题（同时是文本域的无障碍名） */
  settingsSystemPrompt: string
  /** 设置卡：温度那一段的小标题（同时是滑杆的无障碍名） */
  /** MCP 服务器面板的标题（清单上方那行） */
  mcpServersTitle: string
  /** 面板表头计数：`2 of 3 connected`（只数连上的） */
  mcpConnectedCount: (connected: number, total: number) => string
  /** 行上的工具数：`3 tools` / `1 tool` */
  mcpToolCount: (count: number) => string
  /** 四档连接状态：圆点的读屏文案，也用于配置卡上的徽标 */
  mcpStatusConnected: string
  mcpStatusConnecting: string
  mcpStatusNeedsAuth: string
  mcpStatusFailed: string
  /** 待授权行里的授权动作 */
  mcpAuthorize: string
  /** 配置弹窗：标题与一句说明 */
  mcpConfigTitle: string
  mcpConfigDescription: string
  /** 应用预置的连接器那一段 */
  mcpConnectors: string
  /** 连接器空态 */
  mcpNoConnectors: string
  /** 用户自己加的服务器那一段 */
  mcpCustomServers: string
  /** 打开添加表单的按钮 */
  mcpAddServer: string
  /** 卡片动作 */
  mcpConnect: string
  mcpDisconnect: string
  mcpRemove: string
  settingsTemperature: string
  attachmentType: (type: string) => string
  attachmentLabel: (type: string, state: 'idle' | 'uploading' | 'error') => string
  attachmentPreview: string
  attachmentPreviewTitle: string
  removeAttachment: string
  addAttachment: string
  /** 附件预览里的缩放：按钮与口径提示 */
  zoomIn: string
  zoomOut: string
  zoomReset: string
  zoomHint: string
  uploadFailed: string
  /** `name` 缺省时用「文件」类兜底名 */
  downloadFile: (name?: string) => string

  // 图片
  generatingImage: string
  imageGenerationFailed: string
  imageContent: string
  imagePreview: string
  imageBlockedByProvider: string
  clickToZoom: string
  zoomedImage: string
  closeZoomedImage: string
  regenerateImage: string
  downloadImage: string
  copyImage: string

  // 代码 diff 卡片（code-diff）
  /** 折叠态的开关：展开正文 */
  diffExpand: string
  /** 展开态的开关：收起正文 */
  diffCollapse: string

  // 审阅式 diff（reviewable-diff）
  /** 头部的口径：已保留块数 / 总块数 */
  reviewKeptOfTotal: (kept: number, total: number) => string
  reviewKeep: string
  reviewDiscard: string
  /** 块上按钮的无障碍文案：带上范围，读屏才知道决定的是哪一块 */
  reviewKeepHunk: (range: string) => string
  reviewDiscardHunk: (range: string) => string
  /** 已决定的块点回去重选 */
  reviewUndoHunk: (range: string) => string
  reviewKept: string
  reviewDiscarded: string
  reviewLeftToReview: (count: number) => string
  reviewAllReviewed: string
  /** 「应用」按钮：带上要保留的块数 */
  reviewApply: (count: number) => string
}

const DAY_WORDS_EN = { today: 'Today', yesterday: 'Yesterday' }

/**
 * 工具名 → 动词。按名字归类（`read_file` / `run_command` / `apply_patch` 这类），
 * 归不进去就用工具名本身 —— 猜错比不显示更糟。宿主的工具名口径不同就往 labels 里覆盖。
 */
function findTimelineVerb(toolName: string): string {
  const name = toolName.toLowerCase()
  if (/(write|edit|patch|apply)/.test(name)) return 'Edited'
  if (/(read|view|cat)/.test(name)) return 'Read'
  if (/(run|shell|exec|command|terminal)/.test(name)) return 'Ran'
  if (/(search|grep|find|query)/.test(name)) return 'Searched'
  if (/(list|glob|tree)/.test(name)) return 'Listed'
  if (/(fetch|web|browse|http)/.test(name)) return 'Browsed'
  return toolName
}

const ASSISTANT_LABELS_EN: AssistantLabels = {
  newThread: 'New Thread',
  searchThreads: 'Search threads',
  noThreads: 'No threads found',
  loadingThreads: 'Loading threads',
  untitledThread: 'New Chat',
  running: 'Running',
  renameThread: 'Rename thread',
  moreOptions: 'More options',
  rename: 'Rename',
  archive: 'Archive',
  delete: 'Delete',

  welcome: 'How can I help you today?',
  loadingConversation: 'Loading conversation',
  scrollToBottom: 'Scroll to bottom',
  conversationMap: 'Conversation map',
  userMessageLocatorItem: (ordinal, total) => `Your message ${ordinal} / ${total}`,
  userMessageSticky: 'Jump to your message',
  dayLabel: (date) => findDayLabel(date, DAY_WORDS_EN),
  stoppedRun: 'Response stopped',
  completedRun: 'Completed',
  truncatedRun: 'Response truncated (length limit)',
  interruptedRun: 'Response interrupted',
  working: 'Thinking…',
  copy: 'Copy',
  reload: 'Refresh',
  more: 'More',
  exportMarkdown: 'Export as Markdown',
  edit: 'Edit',
  editDiscardsReplies: (count) => `Sending discards ${count} ${count === 1 ? 'reply' : 'replies'}`,
  cancel: 'Cancel',
  update: 'Update',
  previous: 'Previous',
  next: 'Next',
  send: 'Send message',
  stopGenerating: 'Stop generating',
  startDictation: 'Start voice input',
  stopDictation: 'Stop voice input',

  composerPlaceholder: 'Send a message...',
  composerPlaceholderContinue: 'Continue this task...',
  messageInput: 'Message input',

  composerPlaceholderRunning: 'Queue with Enter · Ctrl+Enter to steer now',
  composerDisabledHint: 'Input is disabled while this run is in progress',
  promptLibrarySearch: 'Search prompts',
  promptLibraryList: 'Saved prompts',
  promptLibraryEmpty: 'No saved prompts yet',
  promptLibraryVariables: (count) => (count === 1 ? '1 var' : count + ' vars'),
  queueHeading: 'Queued',
  queueRemove: 'Remove from queue',
  queueRemoveItem: (text) => `Remove "${text}" from the queue`,
  queueSendsWhenFinishes: 'sends when this finishes',
  queueRunning: 'running',
  queueSteerNow: 'Send now',
  sendQueued: 'Add to queue',
  sendQueuedHint: 'Add to queue · hold Alt to steer now',
  queuedMessages: (count) => (count === 1 ? '1 queued' : `${count} queued`),
  queueStopHint: 'Stopping ends this run only — queued messages still send',
  queueExpand: 'Expand queue',
  queueCollapse: 'Collapse queue',
  queueEmptyPreview: '(no text)',
  queueLines: (count) => `⏎ ${count} lines`,
  queueTakeBack: 'Edit in composer',
  queueMoveUp: 'Move up',
  queueMoveDown: 'Move down',
  queuePendingHeading: (count) => (count === 1 ? '1 unsent message' : `${count} unsent messages`),
  queuePendingSend: 'Send this one',
  queuePendingDrop: 'Discard',
  errorRetry: 'Retry',
  /*
   * 「思考」是**跑完**的说法：一个光秃秃的名词摆在折叠条上，读者分不清是跑完了
   * 还是卡住了（现象：整轮只显示「思考」两个字，像会话已经断掉）。所以完成态
   * 一律带过去时 / 完成标记；进行中由 `working`（「思考中…」）负责，两边不共用词。
   */
  reasoning: (seconds) => (seconds ? `Thought for ${seconds}s` : 'Thought'),
  process: (steps, seconds) =>
    steps === undefined
      ? `Process${seconds ? ` · ${seconds}s` : ''}`
      : `Process · ${steps} ${steps === 1 ? 'step' : 'steps'}${seconds ? ` · ${seconds}s` : ''}`,
  processDetail: (tools, thoughts, notes) =>
    [
      tools ? `${tools} ${tools === 1 ? 'tool call' : 'tool calls'}` : '',
      thoughts ? `${thoughts} ${thoughts === 1 ? 'thought' : 'thoughts'}` : '',
      notes ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : ''
    ]
      .filter(Boolean)
      .join(' · '),
  processNote: 'Note',
  processMore: (count) => `${count} more ${count === 1 ? 'step' : 'steps'}`,
  toolCalls: (count, failed) =>
    `${count} tool ${count === 1 ? 'call' : 'calls'}${failed ? `, ${failed} failed` : ''}`,
  runWorking: 'Working',
  runWorked: 'Worked for',
  runCompleted: 'Completed',
  runNeedsAction: 'Needs your input',
  runStopped: 'Stopped after',
  runFailed: 'Failed after',
  runIncomplete: 'Incomplete',
  runToolActivity: (toolName) => `Running ${toolName}`,
  runCollapse: 'Collapse',
  timelineWorking: 'Working',
  timelineSteps: (count) => `${count} step${count === 1 ? '' : 's'}`,
  filesChanged: (count) => `${count} file${count === 1 ? '' : 's'} changed`,
  timelineVerb: findTimelineVerb,
  toolUsed: 'Used tool',
  toolCallActive: (label) => 'Running ' + label,
  toolCallRequest: 'Request',
  toolCallResult: 'Result',
  toolCancelled: 'Cancelled tool',
  toolResult: 'Result:',
  toolError: 'Error:',
  toolCancelledReason: 'Cancelled reason:',
  toolApprovedResult: 'Approved by user',
  toolDeniedResult: 'User denied tool execution',
  toolApprove: 'Allow',
  toolAllowAlways: 'Always allow',
  toolDeny: 'Deny',
  toolDenyAlways: 'Always deny',
  toolConfirm: 'Confirm',
  toolBack: 'Back',
  toolAnswerSend: 'Send',
  toolAnswerLabel: 'Answer',
  toolNoteLabel: 'Note',
  toolAnswerPlaceholder: 'Type your answer',
  toolNotePlaceholder: 'Add a note to your decision',
  planCount: (completed, total) => `${completed} of ${total}`,
  planProgress: (title) => (title ? `${title} progress` : 'Plan progress'),
  planProgressValue: (completed, total) =>
    `${completed} of ${total} ${total === 1 ? 'step' : 'steps'}`,
  planStepDone: 'done',
  planStepActive: 'in progress',
  planStepAhead: 'not started',
  planExpand: (total) => `Show all ${total} step${total === 1 ? '' : 's'}`,
  planCollapse: 'Collapse',
  planTitle: 'Plan',
  planCardTitle: 'Execution plan',
  planSuperseded: (revision) => `Superseded by r${revision}`,
  jobProgress: (title) => `${title} progress`,
  jobRunning: 'running',
  jobDone: 'done',
  jobPartial: 'partly done',
  jobFailed: 'failed',
  jobCancelled: 'cancelled',
  jobCancel: 'Cancel the job',
  jobStageAnnounce: (name) => `Stage ${name}`,
  jobOutcomeAnnounce: (word) => `Job ${word}`,
  jobStageCommand: 'command',
  jobCommandOutput: 'Output',
  webSearchSearching: 'Searching the web',
  webSearchCount: (count) => (count === 1 ? 'Read 1 source' : 'Read ' + count + ' sources'),
  webSearchEmpty: 'No sources found',
  retrievalRetrieving: 'Retrieving',
  retrievalMatches: (count) =>
    count === 1 ? '1 passage above threshold' : count + ' passages above threshold',
  retrievalEmpty: 'No passage above threshold',
  retrievalFuzzy: 'fuzzy',
  retrievalFuzzyHint: 'Short query matched by substring, so there is no relevance score',
  retrievalMeter: (source) => source + ' relevance score',
  timelineAllDay: 'All day',
  timelineUntitled: 'Untitled event',
  timelineUntil: (clock) => 'until ' + clock,
  timelineReading: 'Reading the calendar',
  timelineEmpty: 'Nothing scheduled',
  approvalDefaultTitle: 'Approval needed',
  approvalDefaultSubtitle: 'The agent is waiting for your decision',
  approvalAllowOnce: 'Allow once',
  approvalAlwaysAllow: 'Always allow',
  approvalDeny: 'Deny',
  approvalRunning: 'Running…',
  approvalDone: 'Finished',
  approvalDenied: 'Denied',
  approvalStale: 'This approval has expired — send the request again',
  scheduleNext: 'Next',
  scheduleRecentRuns: 'Recent runs',
  schedulePaused: 'Paused',
  scheduleRunOk: 'ok',
  scheduleRunFailed: 'failed',
  schedulePause: (name) => 'Pause ' + name,
  scheduleResume: (name) => 'Resume ' + name,
  contextTitle: 'Context',
  contextUsage: 'Context usage',
  contextMeterLabel: (label) => label + ' context usage',
  contextMeterValue: (used, limit) => used + ' of ' + limit,
  contextTotal: 'Total',
  contextSystem: 'System',
  contextTools: 'Tools',
  contextMessages: 'Messages',
  contextHeadroom: 'Headroom',
  contextAttachments: 'Attached files',

  settingsModel: 'model',
  settingsSystemPrompt: 'system prompt',
  settingsTemperature: 'temperature',

  mcpServersTitle: 'Servers',
  mcpConnectedCount: (connected, total) => `${connected} of ${total} connected`,
  mcpToolCount: (count) => (count === 1 ? '1 tool' : `${count} tools`),
  mcpStatusConnected: 'connected',
  mcpStatusConnecting: 'connecting',
  mcpStatusNeedsAuth: 'needs auth',
  mcpStatusFailed: 'failed',
  mcpAuthorize: 'Authorize',
  mcpConfigTitle: 'MCP servers',
  mcpConfigDescription: 'Connect servers to expose their tools to this assistant.',
  mcpConnectors: 'Connectors',
  mcpNoConnectors: 'No connectors configured',
  mcpCustomServers: 'Custom servers',
  mcpAddServer: 'Add server',
  mcpConnect: 'Connect',
  mcpDisconnect: 'Disconnect',
  mcpRemove: 'Remove',
  attachmentType: (type) => {
    switch (type) {
      case 'image':
        return 'Image'
      case 'document':
        return 'Document'
      case 'file':
        return 'File'
      default:
        return type
    }
  },
  attachmentLabel: (type, state) => {
    const suffix =
      state === 'error' ? ', upload failed' : state === 'uploading' ? ', uploading' : ''
    return `${type} attachment${suffix}`
  },
  attachmentPreview: 'Attachment preview',
  attachmentPreviewTitle: 'Image Attachment Preview',
  removeAttachment: 'Remove file',
  addAttachment: 'Add Attachment',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomReset: 'Reset zoom',
  zoomHint: 'Scroll to zoom · double-click to reset',
  uploadFailed: 'Upload failed',
  downloadFile: (name) => `Download ${name || 'file'}`,

  generatingImage: 'Generating image…',
  imageGenerationFailed: 'Image could not be generated',
  imageContent: 'Image content',
  imagePreview: 'Image preview',
  imageBlockedByProvider: 'The provider blocked this image.',
  clickToZoom: 'Click to zoom image',
  zoomedImage: 'Zoomed image',
  closeZoomedImage: 'Close zoomed image',
  regenerateImage: 'Regenerate image',
  downloadImage: 'Download image',
  copyImage: 'Copy image',

  diffExpand: 'Expand diff',
  diffCollapse: 'Collapse diff',

  reviewKeptOfTotal: (kept, total) => `${kept} of ${total} kept`,
  reviewKeep: 'Keep',
  reviewDiscard: 'Discard',
  reviewKeepHunk: (range) => `Keep hunk ${range}`,
  reviewDiscardHunk: (range) => `Discard hunk ${range}`,
  reviewUndoHunk: (range) => `Change decision for hunk ${range}`,
  reviewKept: 'Kept',
  reviewDiscarded: 'Discarded',
  reviewLeftToReview: (count) => (count === 1 ? '1 left to review' : `${count} left to review`),
  reviewAllReviewed: 'All reviewed',
  reviewApply: (count) => `Apply ${count}`
}

type AssistantLabelsOverride = Partial<AssistantLabels>

const AssistantLabelsContext = createContext<AssistantLabels>(ASSISTANT_LABELS_EN)

/**
 * 注入语言。未覆盖的字段沿用英文兜底，因此可以只传需要改的那几条。
 * 放在 runtime provider 之外即可 —— 本上下文与 assistant-ui 的状态无关。
 */
const AssistantLabelsProvider: FC<PropsWithChildren<{ labels?: AssistantLabelsOverride }>> = ({
  labels,
  children
}) => {
  const merged = useMemo(
    function merge() {
      return labels ? { ...ASSISTANT_LABELS_EN, ...labels } : ASSISTANT_LABELS_EN
    },
    [labels]
  )

  return (
    <AssistantLabelsContext.Provider value={merged}>{children}</AssistantLabelsContext.Provider>
  )
}

function useAssistantLabels(): AssistantLabels {
  return useContext(AssistantLabelsContext)
}

export { ASSISTANT_LABELS_EN, AssistantLabelsProvider, useAssistantLabels }
export type { AssistantLabels, AssistantLabelsOverride }
