/**
 * 会话排序：左栏工作区树与搜索弹框共用同一套规则。
 *
 * 从上到下：
 * 1. **草稿**：还没落库的新会话（列表项 `status === 'new'`）。点完「新建会话」它必须出现在最上面
 *    —— 它没有活动时间，按时间排会沉到列表最底，用户找不到自己正要输入的那一行；
 *    多个草稿之间按列表插入顺序（`order`，越小越靠前），不用 id：草稿 id 是随机 UUID，
 *    拿它兜底会让「连点两次新建」的顺序变成掷骰子；
 * 2. **置顶**；
 * 3. **最近活动倒序**：`agent_session.updatedAt`，由消息写入（Rust
 *    `agent_message::Service::write_one`）和元数据编辑（`agent_session::Service::update_one`
 *    无条件刷 now）共同刷新，客户端 `updateThread` / `toTouchSession` 同步推这个值。
 *    注意列表项的 `lastMessageAt` 只在 `list()` 时刷新，调用方要用 `latestTime` 与库里的行
 *    取较新者，否则新建会话发完第一条消息就沉底（见 `use-sidebar-branches.ts`）；
 * 4. **id 兜底**：同一毫秒更新的两条不该因为库返回顺序不同而在两次刷新之间来回跳。
 *
 * 时间一律先归一：列表项的 `lastMessageAt` 是 `new Date(thread.updatedAt)`，库里 `updatedAt` 为 0
 * 的老行会给 `Invalid Date`，`getTime()` 是 NaN；NaN 参与比较恒为 false，排序就退化成引擎实现
 * 定义的顺序 —— 这种「看起来随机」的抖动比排错更难查。
 */

interface SortableSession {
  id: string
  pinned?: boolean
  /** 未落库的新会话：排在最前（见文件头第 1 条） */
  draft?: boolean
  /** epoch ms；缺失 / NaN / `Invalid Date` 都按 0 处理 */
  updatedAt?: number | null
  /** 列表插入顺序（只有草稿用得上）：越小越靠前；缺失按「最旧」处理 */
  order?: number
}

/** `Invalid Date` / NaN / 空值统一成 0（= 从没有过活动） */
function toTime(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 缺省的插入顺序排到最后（不相较先后，交给后面的 id 兜底） */
function toOrder(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

/** 置顶 → 最近活动 → id。工作区列表也是这套（同样是「置顶 + 最近改动」） */
function compareByPinnedRecency(a: SortableSession, b: SortableSession): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1

  const byTime = toTime(b.updatedAt) - toTime(a.updatedAt)
  if (byTime !== 0) return byTime

  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** 会话：草稿压过一切（包括置顶），其余与工作区同规则 */
function compareSessions(a: SortableSession, b: SortableSession): number {
  if (Boolean(a.draft) !== Boolean(b.draft)) return a.draft ? -1 : 1

  if (a.draft && b.draft) {
    const byOrder = toOrder(a.order) - toOrder(b.order)
    if (byOrder !== 0) return byOrder
  }

  return compareByPinnedRecency(a, b)
}

/** 返回排好序的**新**数组（`toSorted`），不改入参 */
function orderSessions<T extends SortableSession>(sessions: readonly T[]): T[] {
  return sessions.toSorted(compareSessions)
}

/** 两个来源的「最近活动」取较新者（0 = 都没有活动；`Invalid Date` 已归一） */
function latestTime(...values: Array<number | null | undefined>): number {
  let max = 0
  for (const value of values) max = Math.max(max, toTime(value))
  return max
}

export { compareByPinnedRecency, compareSessions, latestTime, orderSessions, toTime }
export type { SortableSession }
