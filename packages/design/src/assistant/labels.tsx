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
  working: string
  copy: string
  reload: string
  more: string
  exportMarkdown: string
  edit: string
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
  messageInput: string
  /** 待发送队列标题 */
  queueHeading: string
  queueRemove: string
  queueSteerNow: string
  /** 运行中点击发送（入队） */
  sendQueued: string
  /** 输入区上方排队条标题 */
  queuedMessages: (count: number) => string
  removeQueuedMessage: string

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
  working: 'Thinking…',
  copy: 'Copy',
  reload: 'Refresh',
  more: 'More',
  exportMarkdown: 'Export as Markdown',
  edit: 'Edit',
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
  queueHeading: 'Queued',
  queueRemove: 'Remove from queue',
  queueSteerNow: 'Send now',
  sendQueued: 'Add to queue',
  queuedMessages: (count) => (count === 1 ? '1 queued' : `${count} queued`),
  removeQueuedMessage: 'Remove from queue',
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
  copyImage: 'Copy image'
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
