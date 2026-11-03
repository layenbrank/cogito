/** Ctrl+P 数据源合并：已打开 → 最近 → 多根搜索，按绝对路径去重 */
interface FileHit {
  absolute: string
  name: string
  relative: string
  /** 已打开标签：直接激活，不再读盘 */
  isOpen?: boolean
  isDirty?: boolean
  /** 所属根目录名（多根时用于区分同名文件） */
  rootName?: string
}

interface MergeFileHitsInput {
  open: FileHit[]
  recent: FileHit[]
  search: FileHit[]
}

function hitKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function mergeFileHits(input: MergeFileHitsInput): FileHit[] {
  const seen = new Set<string>()
  const merged: FileHit[] = []
  for (const group of [input.open, input.recent, input.search]) {
    for (const hit of group) {
      const key = hitKey(hit.absolute)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(hit)
    }
  }
  return merged
}

export { mergeFileHits, hitKey }
export type { FileHit, MergeFileHitsInput }
