/**
 * Explorer 分页与「显示更多」哨兵（纯函数，无 IO）。
 *
 * 为什么要有分页：一层目录可能有上千个子项（`node_modules` / `.pnpm` / `dist`），
 * 一次性全铺进 DOM 会把主线程钉住。这里只做「取多少」的算术，读盘仍在 `fs.ts`。
 *
 * 排序在切片之前（`fs.ts` 里先 sort 再 paginate），所以同一目录的多次分页
 * 结果稳定、不会重复也不会漏 —— `nextOffset` 只是「已取条数」。
 */

/** 首屏与每次「显示更多」的条数上限 */
const EXPLORER_PAGE_SIZE = 200
/** 一次渲染最多同步挂多少行，其余按帧灌入 */
const EXPLORER_CHUNK_SIZE = 50

/** 「显示更多」哨兵节点的 key 后缀：真实相对路径不可能含 `::__more__` */
const LOAD_MORE_SUFFIX = '::__more__'

interface PageSlice<T> {
  entries: T[]
  isTruncated: boolean
  /** 已取到的总条数，下一次分页从这里开始 */
  nextOffset: number
  /** 这一层目录一共有多少条（用于「还有 N 项」文案） */
  total: number
}

/** 从**已排序**的全量列表里切一页 */
function paginateEntries<T>(all: readonly T[], offset: number, limit: number): PageSlice<T> {
  const total = all.length
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : EXPLORER_PAGE_SIZE
  const end = Math.min(safeOffset + safeLimit, total)
  const entries = safeOffset >= total ? [] : all.slice(safeOffset, end)
  return {
    entries,
    isTruncated: end < total,
    nextOffset: safeOffset + entries.length,
    total
  }
}

/**
 * 追加子项时按 key 去重（保序，已存在的以 previous 为准）。
 *
 * 分页 + 分帧 + watch 刷新可能同时往同一层塞子项，重复 key 会让 React 报警
 * 并让行位置错乱。默认按 `path` 取 key，树节点传 `node.key`。
 */
function appendUniqueEntries<T>(
  previous: readonly T[],
  next: readonly T[],
  getKey: (item: T) => string = function (item) {
    return (item as { path: string }).path
  }
): T[] {
  if (next.length === 0) return previous.slice()
  const seen = new Set<string>()
  for (const entry of previous) seen.add(getKey(entry))
  const merged = previous.slice()
  for (const entry of next) {
    const key = getKey(entry)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }
  return merged
}

/** 给某层目录造「显示更多」哨兵 key */
function makeLoadMoreKey(treeKey: string): string {
  return `${treeKey}${LOAD_MORE_SUFFIX}`
}

/** 从哨兵 key 还原所属目录的 key；非哨兵返回 null */
function toLoadMoreParentKey(treeKey: string): string | null {
  if (!treeKey.endsWith(LOAD_MORE_SUFFIX)) return null
  return treeKey.slice(0, treeKey.length - LOAD_MORE_SUFFIX.length)
}

function findLoadMoreTitle(remaining: number): string {
  return remaining > 0 ? `显示更多（还有 ${remaining} 项）` : '显示更多'
}

export {
  EXPLORER_CHUNK_SIZE,
  EXPLORER_PAGE_SIZE,
  LOAD_MORE_SUFFIX,
  appendUniqueEntries,
  findLoadMoreTitle,
  makeLoadMoreKey,
  paginateEntries,
  toLoadMoreParentKey
}
export type { PageSlice }
