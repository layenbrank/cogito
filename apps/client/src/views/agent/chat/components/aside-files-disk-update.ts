/**
 * 磁盘内容变化时，右栏文件缓冲区该怎么办（纯函数，便于单测）。
 *
 * 背景：`revision` 一变就会重读磁盘，然后把新内容当 prop 传下来。以前的做法是
 * 「无条件复用旧 model + 把基线改成新内容」，效果是：
 * - 缓冲区里还是旧内容，却不再算「脏」；
 * - 按一次保存就把旧内容写回磁盘，把 agent 刚写进去的东西整段回滚。
 *
 * 四种结论：
 * - `create`：换文件 / 首次挂载，照常建或取 model；
 * - `follow-disk`：缓冲区没有未保存改动 → 跟着磁盘走（force 覆盖 + 重置基线）；
 * - `keep-buffer`：只有本地改动、磁盘没变 → 什么都不用做；
 * - `conflict`：缓冲区有未保存改动且磁盘也变了 → 两边都别动，交给用户选。
 */

type DiskUpdatePlan = 'create' | 'follow-disk' | 'keep-buffer' | 'conflict'

interface DiskUpdateInput {
  /** 这次渲染的路径与当前 model 的路径是否同一个文件 */
  isSameFile: boolean
  /** 当前缓冲区内容；还没有 model 时为 null */
  bufferValue: string | null
  /** 基線：最后一次与磁盘一致的内容 */
  savedValue: string
  /** 刚读到的磁盘内容 */
  diskContent: string
}

function planDiskUpdate(input: DiskUpdateInput): DiskUpdatePlan {
  if (!input.isSameFile || input.bufferValue === null) return 'create'
  const hasLocalEdits = input.bufferValue !== input.savedValue
  const diskChanged = input.diskContent !== input.savedValue
  if (hasLocalEdits) return diskChanged ? 'conflict' : 'keep-buffer'
  return 'follow-disk'
}

export { planDiskUpdate }
export type { DiskUpdateInput, DiskUpdatePlan }
