/** 运维探针结果字段 → 中文标签；未知键原样展示 */
const FIELD_LABELS: Record<string, string> = {
  status: '状态',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  startedAt: '开始时间',
  finishedAt: '结束时间',
  error: '错误',
  message: '消息',
  progress: '进度',
  result: '结果',
  payload: '载荷',
  input: '输入',
  output: '输出',
  userID: '用户',
  tenantID: '租户',
  modelID: '模型',
  indexID: '索引',
  documentCount: '文档数',
  chunkCount: '分片数'
}

function findFieldLabel(key: string) {
  return FIELD_LABELS[key] ?? key
}

function formatFieldValue(value: unknown) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number' && value > 1_000_000_000_000) {
    return new Date(value).toLocaleString()
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return '—'
  }
}

export { findFieldLabel, formatFieldValue }
