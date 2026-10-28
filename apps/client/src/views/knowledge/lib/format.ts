/** 知识库面板里的两类格式化：时间与人读的文件尺寸（列表、草稿、任务共用）。 */

function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms))
  } catch (error) {
    console.warn('[knowledge] 时间格式化失败:', error)
    return '—'
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export { formatSize, formatTime }
