/**
 * 线程列表项的按键索引。
 *
 * assistant-ui 的 `threads.threadItems` 可能是**数组**（按列表顺序）也可能是
 * `id → item` 的**记录**（随版本/场景不同）。左栏、后台收件箱都要按 id 反查，
 * 逐条 `.find()` 在数组形态下是 O(线程数 × 条目数)：500 个会话、每次列表重建就是
 * 25 万次比较。这里一次建索引（O(n)），之后查表 O(1)。
 *
 * 同时兼容「记录」形态：直接 `.find()` 会在对象上抛 `threadItems.find is not a function`。
 */

interface ThreadItemSnapshot {
  id?: string
  title?: string
  lastMessageAt?: Date
  status?: string
  custom?: { pinned?: unknown; workspaceID?: unknown }
  remoteId?: string
}

type ThreadItemIndex = Map<string, ThreadItemSnapshot>

function addItem(index: ThreadItemIndex, key: string | undefined, item: ThreadItemSnapshot): void {
  // 先写先赢：`id` 命中优先于 `remoteId`，避免同一线程两条键互相覆盖
  if (!key || index.has(key)) return
  index.set(key, item)
}

/** 建一次索引：`id` 与 `remoteId` 都指向同一项（列表项 id 在落库前后会变） */
function buildThreadItemIndex(threadItems: unknown): ThreadItemIndex {
  const index = new Map<string, ThreadItemSnapshot>()

  if (Array.isArray(threadItems)) {
    for (const item of threadItems as ThreadItemSnapshot[]) {
      if (!item || typeof item !== 'object') continue
      addItem(index, item.id, item)
      addItem(index, item.remoteId, item)
    }
    return index
  }

  if (!threadItems || typeof threadItems !== 'object') return index
  for (const item of Object.values(threadItems as Record<string, ThreadItemSnapshot>)) {
    if (!item || typeof item !== 'object') continue
    addItem(index, item.id, item)
    addItem(index, item.remoteId, item)
  }
  return index
}

function findIndexedThreadItem(
  index: ThreadItemIndex,
  id: string | null | undefined
): ThreadItemSnapshot | null {
  if (!id) return null
  return index.get(id) ?? null
}

export { buildThreadItemIndex, findIndexedThreadItem }
export type { ThreadItemIndex, ThreadItemSnapshot }
