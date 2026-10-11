function findSplitMeta(
  hasFile: boolean,
  mode: 'ranges' | 'limit',
  selectedCount: number,
  pageCount: number,
  limit: number
): string {
  if (!hasFile) return '请先打开 PDF'
  if (mode === 'ranges') return `已选 ${selectedCount} / ${pageCount} 页`
  return `每文件 ${limit} 页 · 共 ${pageCount} 页`
}

function canSplitSubmit(
  hasDest: boolean,
  hasFile: boolean,
  mode: 'ranges' | 'limit',
  limit: number,
  selectedCount: number
): boolean {
  if (!hasDest || !hasFile) return false
  if (mode === 'limit') return limit > 0
  return selectedCount > 0
}

export { findSplitMeta, canSplitSubmit }
