function findMergeMeta(
  isPages: boolean,
  fileName: string,
  hasFile: boolean,
  inputCount: number
): string {
  if (isPages) return hasFile ? `当前文件：${fileName}` : '未打开文件'
  if (inputCount === 0) return '拖入或添加至少 2 个 PDF'
  return `共 ${inputCount} 个文件 · 拖拽卡片调整顺序`
}

function findMergeHint(
  error: string | null,
  canSubmit: boolean,
  isPages: boolean,
  hasFile: boolean,
  inputCount: number
): string | undefined {
  if (error) return error
  if (canSubmit) return undefined
  if (isPages) return hasFile ? '请选择输出路径' : '请先在左侧打开 PDF'
  if (inputCount < 2) return '至少添加 2 个 PDF'
  return '请选择输出路径'
}

function canMergeSubmit(
  isPages: boolean,
  hasFile: boolean,
  hasOutput: boolean,
  inputCount: number
): boolean {
  if (isPages) return hasFile && hasOutput
  return inputCount >= 2 && hasOutput
}

export { findMergeMeta, findMergeHint, canMergeSubmit }
