/**
 * assistant 组件的界面文案（中文）。未覆盖的字段沿用英文兜底。
 */
import type { AssistantLabelsOverride } from '@i-thinking/design/assistant/labels'

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
  working: '助手正在处理',
  copy: '复制',
  reload: '重新生成',
  more: '更多',
  exportMarkdown: '导出 Markdown',
  edit: '编辑',
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
  messageInput: '消息输入',

  reasoning: (seconds) => `思考${seconds ? `（${seconds} 秒）` : ''}`,
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
  copyImage: '复制图片'
}

export { ASSISTANT_LABELS_ZH }
