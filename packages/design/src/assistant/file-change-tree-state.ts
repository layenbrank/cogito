/**
 * File tree（改动文件树）的纯函数层：扁平改动列表 → 节点、汇总、可见行钳制。
 *
 * 元素页的口径：库里**没有**路径 → 树的助手，`buildFileTree` 是宿主自己写的；
 * 本仓把它收在这一层，好让映射能被单测（元素本体 `file-change-tree.tsx` 只负责画）。
 *
 * 与官方示例 `buildFileTree` 的一处刻意不同：示例按「第一次见到的目录」插一行表头、
 * 后面照输入顺序继续 push，目录交错时（`a/x`、`b/y`、`a/z`）第三行会落在 `b` 的块里 ——
 * 行没变，位置错了。这里按**目录分组**（目录顺序 = 首次出现顺序），同一目录的文件始终挨在一起。
 *
 * 目录只分一层：`packages/core/src/convert.ts` 的表头就是 `packages/core/src` 整条路径，
 * 不拆成 `packages` → `core` → `src` 三级（元素页渲染出来的 DOM 就是这么一层的）。
 */
import type { AssistantLabels } from './labels'

/** 宿主给的扁平改动：一个文件一条 */
interface ChangedFile {
  /** 相对路径（分隔符 `/` 或 `\` 都能吃） */
  readonly path: string
  readonly additions?: number
  readonly deletions?: number
}

/** 树上一行。`kind` 与 `depth` 各自独立 —— 一个文件可以顶格出现，没有目录表头压着它 */
interface FileChangeNode {
  /** 只用作 key：行画在哪儿由 `depth` 决定，与 `path` 无关（元素页口径） */
  readonly path: string
  readonly name: string
  /** 缩进档位（0 = 顶格），每档 0.85rem */
  readonly depth: number
  readonly kind: 'folder' | 'file'
  readonly additions?: number
  readonly deletions?: number
}

type FileChangeTreeLabels = Pick<AssistantLabels, 'filesChanged'>

/** 去掉 `./`、统一分隔符、去掉尾斜杠 —— 同一份改动不该因为写法不同被拆成两行 */
function normalizePath(path: string): string {
  let next = path.trim().replace(/\\/g, '/')
  while (next.startsWith('./')) next = next.slice(2)
  return next.replace(/\/+$/, '')
}

function splitDir(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  if (slash === -1) return { dir: '', name: path }
  return { dir: path.slice(0, slash), name: path.slice(slash + 1) }
}

/**
 * 扁平列表 → 树行（目录表头 + 文件行）。
 *
 * - 目录顺序 = 首次出现顺序，同一目录的文件挨在一起；顶格文件按输入位置自成一组
 * - 同一路径出现多次（工具改了两遍）**合并成一行**并把增删相加 —— 这里答的是
 *   「这次一共动了哪些文件」，不是「工具调用了几次」
 * - 空路径直接丢掉（没有名字就没法显示，也当不了 key）
 */
function buildChangeNodes(files: readonly ChangedFile[]): FileChangeNode[] {
  const buckets = new Map<
    string,
    Map<string, { name: string; additions: number; deletions: number }>
  >()
  const order: string[] = []

  for (const file of files) {
    const path = normalizePath(file.path)
    if (!path) continue
    const { dir, name } = splitDir(path)
    let bucket = buckets.get(dir)
    if (!bucket) {
      bucket = new Map()
      buckets.set(dir, bucket)
      order.push(dir)
    }
    const previous = bucket.get(path)
    if (previous) {
      previous.additions += file.additions ?? 0
      previous.deletions += file.deletions ?? 0
    } else {
      bucket.set(path, {
        name,
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0
      })
    }
  }

  const nodes: FileChangeNode[] = []
  for (const dir of order) {
    const bucket = buckets.get(dir)
    if (!bucket) continue
    // 目录表头是静态的、不可折叠：它只是给下面几行一个归属
    if (dir) nodes.push({ path: dir, name: dir, depth: 0, kind: 'folder' })
    for (const [path, entry] of bucket) {
      nodes.push({
        path,
        name: entry.name,
        depth: dir ? 1 : 0,
        kind: 'file',
        additions: entry.additions,
        deletions: entry.deletions
      })
    }
  }
  return nodes
}

/** 表头数字：只数 `kind: 'file'`，目录表头不算文件（元素页口径） */
function summarizeChangeNodes(nodes: readonly FileChangeNode[]): {
  files: number
  additions: number
  deletions: number
} {
  let files = 0
  let additions = 0
  let deletions = 0
  for (const node of nodes) {
    if (node.kind !== 'file') continue
    files += 1
    additions += node.additions ?? 0
    deletions += node.deletions ?? 0
  }
  return { files, additions, deletions }
}

/**
 * 露出前几行：向下取整并钳进 `0…total` —— 「节点已经产生但还没露头」是合法状态。
 * 与 `tool-timeline-state.ts::resolveVisibleSteps` 同一套规则，两处都别改动其中一处。
 */
function resolveVisibleRows(visibleRows: number | undefined, total: number): number {
  if (visibleRows === undefined) return total
  if (!Number.isFinite(visibleRows)) return 0
  return Math.max(0, Math.min(Math.floor(visibleRows), total))
}

/** 表头文案：`4 files changed`（文案走 labels，组件里不写死语言） */
function formatChangedFilesLabel(fileCount: number, labels: FileChangeTreeLabels): string {
  return labels.filesChanged(fileCount)
}

export {
  buildChangeNodes,
  formatChangedFilesLabel,
  normalizePath,
  resolveVisibleRows,
  summarizeChangeNodes
}
export type { ChangedFile, FileChangeNode, FileChangeTreeLabels }
