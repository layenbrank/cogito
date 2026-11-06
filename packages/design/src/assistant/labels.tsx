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
  /** 左侧用户消息标尺（Cursor 式刻度导航） */
  userMessageLocator: string
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
  /** 推理折叠条：`seconds` 只在有耗时时给出 */
  reasoning: (seconds?: number) => string
  /**
   * 过程折叠条（整轮：思考 + 工具 + 中间解说）：`steps` 是过程区的 part 数，
   * `seconds` 只在有耗时时给出。
   */
  process: (steps: number, seconds?: number) => string
  /** 工具折叠条：`failed` 只在确实有失败时给出 */
  toolCalls: (count: number, failed?: number) => string
  attachmentType: (type: string) => string
  attachmentLabel: (type: string, state: 'idle' | 'uploading' | 'error') => string
  attachmentPreview: string
  attachmentPreviewTitle: string
  removeAttachment: string
  addAttachment: string
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
  userMessageLocator: 'Jump to your messages',
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
  editDiscardsReplies: (count) =>
    `Sending discards ${count} ${count === 1 ? 'reply' : 'replies'}`,
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
  queuePendingHeading: (count) =>
    count === 1 ? '1 unsent message' : `${count} unsent messages`,
  queuePendingSend: 'Send this one',
  queuePendingDrop: 'Discard',
  errorRetry: 'Retry',
  reasoning: (seconds) => (seconds ? `Reasoning · ${seconds}s` : 'Reasoning'),
  process: (steps, seconds) =>
    `Process · ${steps} ${steps === 1 ? 'step' : 'steps'}${seconds ? ` · ${seconds}s` : ''}`,
  toolCalls: (count, failed) =>
    `${count} tool ${count === 1 ? 'call' : 'calls'}${failed ? `, ${failed} failed` : ''}`,
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
