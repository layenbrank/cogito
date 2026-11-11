/**
 * Timeline（对齐 assistant-ui `elements/timeline`）的刻度：可见条数的钳制 + 「这一条相对现在」的判定。
 *
 * 元素只按 `when` 上色，不读时钟；判定留在这里，是因为它和 `visibleCount` 一样属于
 * **宿主喂数据时**要算的账：同一份事件隔一分钟再看，`now` 那一条会往后挪。
 */

/** 一条事件相对「现在」的位置：决定圆点、连线与标题字重 */
type TimelineWhen = 'past' | 'now' | 'future'

/** 元素认的一条事件 */
interface TimelineEvent {
  /** 稳定 id（React key） */
  id: string
  /** 这一条在时间轴上的位置 */
  when: TimelineWhen
  /** 左列的时刻：`09:02` / `Mon` / `全天` 都行（元素不解析它） */
  time: string
  /** 主标题 */
  title: string
  /** 可选的一行说明 */
  detail?: string
}

/**
 * 逐条落进来的进度：向下取整后钳进 0…total。
 * NaN / 负数当 0（还没开始），超过总数按总数（一次给全量）。
 */
function clampVisibleCount(count: number, total: number): number {
  const max = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  if (!Number.isFinite(count)) return 0
  const floored = Math.floor(count)
  if (floored <= 0) return 0
  if (floored >= max) return max
  return floored
}

/**
 * 一段区间落在 `now` 的哪一侧：结束时刻已过 → past，还没开始 → future，
 * 其余（含正好卡在两端）算 now —— 正在进行的这场安排才是要看的。
 */
function toTimelineWhen(startAt: number, endAt: number, now: number): TimelineWhen {
  if (Number.isFinite(endAt) && endAt < now) return 'past'
  if (Number.isFinite(startAt) && startAt > now) return 'future'
  return 'now'
}

export { clampVisibleCount, toTimelineWhen }
export type { TimelineWhen, TimelineEvent }
