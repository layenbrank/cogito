/**
 * assistant 组件的界面文案（中文）。未覆盖的字段沿用英文兜底。
 */
import type { AssistantLabelsOverride } from '@cogito/design/assistant/labels'
import { findDayLabel } from '@cogito/design/assistant/thread-day'

import { toAgentToolLabel } from '@/features/agent/tool-labels'

const DAY_WORDS_ZH = { today: '今天', yesterday: '昨天' }

const ASSISTANT_LABELS_ZH: AssistantLabelsOverride = {
  newThread: '新建对话',
  searchThreads: '搜索会话',
  noThreads: '还没有会话',
  loadingThreads: '正在加载会话',
  untitledThread: '新对话',
  running: '运行中',
  renameThread: '重命名会话',
  moreOptions: '更多操作',
  rename: '重命名',
  archive: '归档',
  delete: '删除',

  welcome: '我能帮你做点什么？',
  loadingConversation: '正在加载对话',
  scrollToBottom: '滚到底部',
  conversationMap: '消息刻度',
  userMessageLocatorItem: (ordinal, total) => `你的消息 ${ordinal} / ${total}`,
  userMessageSticky: '回到这条用户消息',
  dayLabel: (date) => findDayLabel(date, DAY_WORDS_ZH, 'zh-CN'),
  stoppedRun: '已停止生成',
  completedRun: '已完成',
  truncatedRun: '输出被截断（达到长度上限）',
  interruptedRun: '生成被中断',
  working: '思考中…',
  copy: '复制',
  reload: '重新生成',
  more: '更多',
  exportMarkdown: '导出 Markdown',
  edit: '编辑',
  editDiscardsReplies: (count) => `发送后将丢弃 ${count} 条回复`,
  cancel: '取消',
  update: '更新',
  previous: '上一步',
  next: '下一步',
  send: '发送',
  stopGenerating: '停止生成',
  startDictation: '开始语音输入',
  stopDictation: '停止语音输入',

  composerPlaceholder: '发消息…',
  composerPlaceholderContinue: '继续这个任务…',
  composerPlaceholderRunning: 'Enter 入队 · Ctrl+Enter 立即转向',
  composerDisabledHint: '本轮运行中，暂时不能输入',
  messageInput: '消息输入',
  queueHeading: '待发送',
  queueRemove: '移出队列',
  queueRemoveItem: (text) => `移出队列：${text}`,
  queueSendsWhenFinishes: '本轮结束后自动发送',
  queueRunning: '运行中',
  queueSteerNow: '立即发送',
  sendQueued: '加入队列',
  sendQueuedHint: '加入队列 · 按住 Alt 点击立刻插队',
  queuedMessages: (count) => (count === 1 ? '1 条排队' : `${count} 条排队`),
  queueStopHint: '停止只中断本轮，排队消息稍后照发',
  queueExpand: '展开队列',
  queueCollapse: '收起队列',
  queueEmptyPreview: '（无文本）',
  queueLines: (count) => `⏎ ${count} 行`,
  queueTakeBack: '取回编辑',
  queueMoveUp: '上移',
  queueMoveDown: '下移',
  queuePendingHeading: (count) => `上次没发出去的（${count}）`,
  queuePendingSend: '发送这条',
  queuePendingDrop: '丢弃',
  errorRetry: '重试',

  // 进行中由 trigger 的 active / working 文案表达；这里只描述**跑完**的那一段。
  // 别退回「思考」两个字：光秃秃的名词摆在折叠条上，分不清是跑完了还是卡住了
  // （现象：整轮只剩「思考」两字，像会话已经终止）。
  reasoning: (seconds) => (seconds ? `已思考 ${seconds} 秒` : '已思考'),
  // 结算后行尾接的是构成行（`processDetail`）：工具 + 思考 + 说明 = 步数，
  // 两个数字并排写等于同一件事说两遍，所以那时 `steps` 传 undefined，只留时长。
  process: (steps, seconds) =>
    steps === undefined
      ? `过程${seconds ? ` · ${seconds} 秒` : ''}`
      : `过程 · ${steps} 步${seconds ? ` · ${seconds} 秒` : ''}`,
  // 总折叠收起后仍要交代「刚才干了什么」：先给构成（几工具 / 几段思考 / 几段说明），
  // 再逐步列明细。只有「过程 · 6 步」等于逼用户展开才能知道跑了什么。
  processDetail: (tools, thoughts, notes) =>
    [
      tools ? `${tools} 次工具` : '',
      thoughts ? `${thoughts} 段思考` : '',
      notes ? `${notes} 段说明` : ''
    ]
      .filter(Boolean)
      .join(' · '),
  processNote: '说明',
  processMore: (count) => `还有 ${count} 步`,
  toolCalls: (count, failed) => `${count} 次工具调用${failed ? `，${failed} 次失败` : ''}`,
  // 整轮活动流水：run-activity 已下线（过程区改成总折叠 + 子折叠），这几条暂时没有使用者
  runWorking: '工作中',
  runWorked: '已工作',
  runCompleted: '已完成',
  runNeedsAction: '等待确认',
  runStopped: '已停止',
  runFailed: '运行失败',
  runIncomplete: '未完成',
  // 工具名先过一遍中文标题（`tool-labels.ts`），折叠条上才读得出差别：十几次 `read_file`
  // 都写「读取文件」时，后接的参数摘要（路径 / 命令）才是「这一步动的是哪儿」。未收录的
  // 工具名（第三方 MCP）原样保留，前面补「调用」，免得只剩一串 snake_case。
  runToolActivity: (toolName) => {
    const label = toAgentToolLabel(toolName)
    return label === toolName ? `调用 ${toolName}` : label
  },
  runCollapse: '收起',
  // 工具时间线（tool-timeline）
  timelineWorking: '工作中',
  timelineSteps: (count) => `${count} 步`,
  // 与 file-tree 表头共用
  filesChanged: (count) => `${count} 个文件改动`,
  // 计划卡（agent-plan）：右端计数、进度条名称与读数、每步读屏状态
  planCount: (completed, total) => `${completed} / ${total}`,
  planProgress: (title) => (title ? `${title}进度` : '计划进度'),
  planProgressValue: (completed, total) => `${completed} / ${total} 步`,
  planStepDone: '已完成',
  planStepActive: '进行中',
  planStepAhead: '未开始',
  // 折叠壳：步数超过阈值时，对话里只留「表头 + 进度条 + 正在做的那一行」
  planExpand: (total) => `展开全部 ${total} 步`,
  planCollapse: '收起',
  planTitle: '计划',
  planCardTitle: '执行计划',
  planSuperseded: (revision) => `已被 r${revision} 取代`,
  // 任务进度卡（job-progress）：什么时候开始、到哪一步、以什么结局收场
  jobProgress: (title) => `${title} 进度`,
  jobRunning: '运行中',
  jobDone: '已完成',
  jobPartial: '部分完成',
  jobFailed: '失败',
  jobCancelled: '已取消',
  jobCancel: '取消任务',
  jobStageCommand: '命令',
  // 检索块（retrieval-chunks）
  retrievalRetrieving: '正在检索知识库',
  retrievalMatches: (count) => count + ' 段命中',
  retrievalEmpty: '没有命中的段落',
  retrievalFuzzy: '模糊',
  retrievalFuzzyHint: '查询不足 3 字，走子串回退，没有相关度分数',
  retrievalMeter: (source) => source + ' 的相关度',
  // 时间轴卡（timeline）
  timelineAllDay: '全天',
  timelineUntitled: '未命名日程',
  timelineUntil: (clock) => '至 ' + clock,
  timelineReading: '正在读取日程',
  timelineEmpty: '这段时间没有安排',
  // 审批卡（approval-card）：卡片标题由工具名给，其余文案在这里
  approvalDefaultTitle: '需要你确认',
  approvalDefaultSubtitle: '确认之后才会继续',
  approvalAllowOnce: '允许一次',
  approvalAlwaysAllow: '始终允许',
  approvalDeny: '拒绝',
  approvalRunning: '正在执行',
  approvalDone: '已完成',
  approvalDenied: '已拒绝',
  approvalStale: '这次审批已经失效，请重新发送',
  scheduleNext: '下次',
  scheduleRecentRuns: '最近执行',
  schedulePaused: '已暂停',
  scheduleRunOk: '成功',
  scheduleRunFailed: '失败',
  schedulePause: (name) => `暂停 ${name}`,
  scheduleResume: (name) => `启用 ${name}`,
  contextTitle: '上下文',
  contextUsage: '上下文用量',
  contextMeterLabel: (label) => label + '占用',
  contextMeterValue: (used, limit) => `${used} / ${limit}`,
  contextTotal: '合计',
  contextSystem: '系统提示词',
  contextTools: '工具',
  contextMessages: '对话',
  contextHeadroom: '剩余',
  contextAttachments: '附件',

  settingsModel: '模型',
  settingsSystemPrompt: '系统提示词',
  settingsTemperature: '温度',
  // 联网搜索卡（web-search）
  webSearchSearching: '正在联网搜索',
  webSearchCount: (count) => '读取 ' + count + ' 个来源',
  webSearchEmpty: '没有找到来源',
  jobCommandOutput: '输出',
  jobStageAnnounce: (name) => `当前阶段：${name}`,
  jobOutcomeAnnounce: (word) => `任务${word}`,
  timelineVerb: (toolName) => {
    const name = toolName.toLowerCase()
    if (/(write|edit|patch|apply)/.test(name)) return '修改'
    if (/(read|view|cat)/.test(name)) return '读取'
    if (/(run|shell|exec|command|terminal)/.test(name)) return '运行'
    if (/(search|grep|find|query)/.test(name)) return '搜索'
    if (/(list|glob|tree)/.test(name)) return '列举'
    if (/(fetch|web|browse|http)/.test(name)) return '浏览'
    return toolName
  },
  // 工具卡（tool-fallback）：一行「用了什么工具」，展开才是参数与结果
  toolUsed: '使用了工具',
  // 工具行（tool-call）：跑着的说法 + 展开后的两块标题
  toolCallActive: (label) => '正在' + label,
  toolCallRequest: '请求',
  toolCallResult: '结果',
  toolCancelled: '已取消工具',
  toolResult: '结果：',
  toolError: '错误：',
  toolCancelledReason: '取消原因：',
  toolApprovedResult: '用户已允许执行',
  toolDeniedResult: '用户拒绝执行该工具',
  toolApprove: '允许',
  toolAllowAlways: '总是允许',
  toolDeny: '拒绝',
  toolDenyAlways: '总是拒绝',
  toolConfirm: '确认',
  toolBack: '返回',
  toolAnswerSend: '发送',
  toolAnswerLabel: '答复',
  toolNoteLabel: '说明',
  toolAnswerPlaceholder: '输入你的答复',
  toolNotePlaceholder: '给这次决定加一句说明',
  attachmentType: (type) => {
    switch (type) {
      case 'image':
        return '图片'
      case 'document':
        return '文档'
      case 'file':
        return '文件'
      default:
        return type
    }
  },
  attachmentLabel: (type, state) => {
    const suffix = state === 'error' ? '，上传失败' : state === 'uploading' ? '，上传中' : ''
    return `${type}附件${suffix}`
  },
  attachmentPreview: '附件预览',
  attachmentPreviewTitle: '图片附件预览',
  removeAttachment: '移除附件',
  addAttachment: '添加附件',
  zoomIn: '放大',
  zoomOut: '缩小',
  zoomReset: '复位缩放',
  zoomHint: '滚轮缩放 · 双击复位',
  uploadFailed: '上传失败',
  downloadFile: (name) => `下载 ${name || '文件'}`,

  generatingImage: '正在生成图片…',
  imageGenerationFailed: '图片生成失败',
  imageContent: '图片内容',
  imagePreview: '图片预览',
  imageBlockedByProvider: '该 provider 不支持生成这张图片。',
  clickToZoom: '点击放大图片',
  zoomedImage: '已放大的图片',
  closeZoomedImage: '关闭放大图片',
  regenerateImage: '重新生成图片',
  downloadImage: '下载图片',
  copyImage: '复制图片',

  diffExpand: '展开改动',
  diffCollapse: '收起改动',

  reviewKeptOfTotal: (kept, total) => `已保留 ${kept} / ${total} 块`,
  reviewKeep: '保留',
  reviewDiscard: '丢弃',
  reviewKeepHunk: (range) => `保留 ${range} 这一块`,
  reviewDiscardHunk: (range) => `丢弃 ${range} 这一块`,
  reviewUndoHunk: (range) => `撤销 ${range} 的决定`,
  reviewKept: '已保留',
  reviewDiscarded: '已丢弃',
  reviewLeftToReview: (count) => `还有 ${count} 块待决定`,
  reviewAllReviewed: '都决定过了',
  reviewApply: (count) => `应用 ${count}`
}

export { ASSISTANT_LABELS_ZH }
