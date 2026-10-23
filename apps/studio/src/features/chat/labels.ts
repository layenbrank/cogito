import type { AssistantLabelsOverride } from '@cogito/design/assistant/labels'

/**
 * 设计包 label 之外的 agent 文案：库不认识这些概念（"不显示次数"这种偏好是 app 的），
 * 只能放在 app 侧。与 `ASSISTANT_LABELS_ZH` 同处一个文件，改语言时只动这里。
 */
const AGENT_LABELS = {
  /** 关掉「显示工具调用次数」后，工具折叠条的文案 */
  toolCallsCompact: '执行工具'
}

/**
 * assistant 组件的中文文案。
 *
 * 界面语言目前只有 zh-CN（没有 i18n 框架），所以集中放这一个文件 ——
 * 设计包只认 key、不认语言，日后要做多语言时改这里即可。
 */
const ASSISTANT_LABELS_ZH: AssistantLabelsOverride = {
  // 会话列表
  newThread: '新的任务',
  searchThreads: '搜索任务',
  noThreads: '还没有任务',
  loadingThreads: '加载中…',
  untitledThread: '未命名任务',
  running: '生成中',
  renameThread: '重命名任务',
  moreOptions: '更多操作',
  rename: '重命名',
  archive: '归档',
  delete: '删除',

  // 消息区
  welcome: '有什么可以帮你的？',
  loadingConversation: '正在加载会话',
  scrollToBottom: '回到底部',
  working: '正在生成',
  copy: '复制',
  reload: '重新生成',
  more: '更多',
  exportMarkdown: '导出为 Markdown',
  edit: '编辑',
  cancel: '取消',
  update: '更新',
  previous: '上一条',
  next: '下一条',
  send: '发送',
  stopGenerating: '停止生成',
  startDictation: '开始语音输入',
  stopDictation: '停止语音输入',

  // 输入区
  composerPlaceholder: '消息，或 @ 引用文件，/ 调用技能',
  composerPlaceholderContinue: '继续这个任务...',
  messageInput: '消息输入框',

  // 部件
  reasoning(seconds) {
    // 思考段自己的折叠条：秒数只在调用方拿得到**这一段**的耗时时给（拿整轮耗时贴上就是骗人）
    return seconds === undefined ? '思考' : `思考 · ${seconds}s`
  },
  process(_steps, seconds) {
    // 整轮回合摘要（Qoder 口径）：秒数由调用方按「耗时显示」设置算好，这里只管拼
    return seconds === undefined ? '已处理' : `已处理 · ${seconds}s`
  },
  toolCalls(count, failed) {
    return failed ? `执行工具 ${count} 次，其中 ${failed} 次失败` : `执行工具 ${count} 次`
  },
  attachmentType(type) {
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
  attachmentLabel(type, state) {
    const suffix = state === 'error' ? '，上传失败' : state === 'uploading' ? '，上传中' : ''
    return `${type}附件${suffix}`
  },
  attachmentPreview: '附件预览',
  attachmentPreviewTitle: '图片附件预览',
  removeAttachment: '移除文件',
  addAttachment: '添加附件',
  uploadFailed: '上传失败',
  downloadFile(name) {
    return `下载 ${name ?? '文件'}`
  },

  // 图片
  generatingImage: '正在生成图片…',
  imageGenerationFailed: '图片生成失败',
  imageContent: '图片内容',
  imagePreview: '图片预览',
  imageBlockedByProvider: '服务商拦截了这张图片。',
  clickToZoom: '点击放大',
  zoomedImage: '放大的图片',
  closeZoomedImage: '关闭放大的图片',
  regenerateImage: '重新生成图片',
  downloadImage: '下载图片',
  copyImage: '复制图片'
}

export { AGENT_LABELS, ASSISTANT_LABELS_ZH }
