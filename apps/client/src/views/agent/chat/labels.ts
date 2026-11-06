/**
 * assistant 组件的界面文案（中文）。未覆盖的字段沿用英文兜底。
 */
import type { AssistantLabelsOverride } from '@cogito/design/assistant/labels'
import { findDayLabel } from '@cogito/design/assistant/thread-day'

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
  userMessageLocator: '跳转到你的消息',
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

  // 进行中由 trigger 的 active / working 文案表达；结束后勿再写「思考中」
  reasoning: (seconds) => (seconds ? `思考（${seconds} 秒）` : '思考'),
  process: (steps, seconds) => `过程 · ${steps} 步${seconds ? ` · ${seconds} 秒` : ''}`,
  toolCalls: (count, failed) => `${count} 次工具调用${failed ? `，${failed} 次失败` : ''}`,
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
