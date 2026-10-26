type RegionKind = 'element' | 'child' | 'client' | 'frame' | 'screen'

/**
 * 选区可吸附的候选矩形（overlay 局部逻辑像素）。
 *
 * `kind` 决定粒度：`element`(UI 元素) → `child`(子控件) → `client`(客户区)
 * → `frame`(窗口框) → `screen`(整屏)。
 */
interface CaptureRegion {
  x: number
  y: number
  w: number
  h: number
  kind?: RegionKind
  /** 所属窗口句柄（十六进制），用于分组与去重 */
  hwnd?: string
  title?: string
  /** 同层 z 序：0 = 最上层 */
  z?: number
  /** 控件类型（如「按钮」）；窗口级为空 */
  control_type?: string
}

/** 由细到粗的层级权重；同权重按面积升序（内层更小） */
const KIND_RANK: Record<RegionKind, number> = {
  element: 0,
  child: 1,
  client: 2,
  frame: 3,
  screen: 4
}

interface HoverStack {
  /** 由细到粗的候选；同一窗口的候选连续排列，末尾是整屏 */
  levels: CaptureRegion[]
  /** 每个候选组（一个窗口 / 整屏）在 levels 里的起始下标 */
  groupStarts: number[]
}

/**
 * 预排好序的候选索引：`groups` 按 z 序排列，组内按「细 → 粗」排好。
 *
 * 悬停是 mousemove 频率的热路径，这里把分组与排序挪到「regions 变化时」做一次，
 * 每次命中只做矩形包含判断。
 */
interface RegionIndex {
  groups: CaptureRegion[][]
}

const EMPTY_INDEX: RegionIndex = { groups: [] }

function containsPoint(region: CaptureRegion, x: number, y: number) {
  return x >= region.x && y >= region.y && x < region.x + region.w && y < region.y + region.h
}

function areaOf(region: CaptureRegion) {
  return region.w * region.h
}

function byGranularity(a: CaptureRegion, b: CaptureRegion) {
  const rankDiff = KIND_RANK[a.kind ?? 'frame'] - KIND_RANK[b.kind ?? 'frame']
  if (rankDiff !== 0) return rankDiff
  return areaOf(a) - areaOf(b)
}

/** 按窗口分组并按 z 序、粒度排好；只在 regions 变化时调用 */
function buildRegionIndex(regions: CaptureRegion[]): RegionIndex {
  if (regions.length === 0) return EMPTY_INDEX

  const buckets = new Map<string, CaptureRegion[]>()
  for (const region of regions) {
    const key = region.hwnd ?? ''
    const bucket = buckets.get(key)
    if (bucket) bucket.push(region)
    else buckets.set(key, [region])
  }

  const groups = Array.from(buckets.values()).sort(function (a, b) {
    return (a[0]?.z ?? 0) - (b[0]?.z ?? 0)
  })
  for (const group of groups) group.sort(byGranularity)
  return { groups }
}

/**
 * 光标处的候选栈：元素链 → 每个窗口的（子控件 → 客户区 → 窗口框）→ 整屏。
 *
 * `elements` 是后端 UIA 返回的元素链（已按细→粗），只会属于最上层那个窗口。
 */
function findHoverStack(
  index: RegionIndex,
  elements: CaptureRegion[],
  x: number,
  y: number,
  screen: { w: number; h: number }
): HoverStack {
  const levels: CaptureRegion[] = []
  const groupStarts: number[] = []
  let isTopGroup = true

  for (const group of index.groups) {
    // 组内最粗的一项就是窗口框：不在框内，整组跳过（大多数窗口只测一次）
    const frame = group[group.length - 1]
    if (!frame || !containsPoint(frame, x, y)) continue

    groupStarts.push(levels.length)
    // 元素链只属于最上层命中的窗口
    if (isTopGroup) {
      isTopGroup = false
      for (const element of elements) {
        if (containsPoint(element, x, y)) levels.push(element)
      }
    }
    for (const region of group) {
      if (containsPoint(region, x, y)) levels.push(region)
    }
  }

  // 没有窗口命中但拿到了元素链（例如全屏应用 / 特殊合成窗口）
  if (levels.length === 0) {
    for (const element of elements) {
      if (containsPoint(element, x, y)) levels.push(element)
    }
    if (levels.length > 0) groupStarts.push(0)
  }

  groupStarts.push(levels.length)
  levels.push({ x: 0, y: 0, w: screen.w, h: screen.h, kind: 'screen' })

  return { levels, groupStarts }
}

/** 滚轮：在候选栈里逐层移动（循环） */
function stepLevel(stack: HoverStack, index: number, delta: number): number {
  const total = stack.levels.length
  if (total === 0) return 0
  return (index + delta + total) % total
}

/** Shift+滚轮：直接跳到相邻窗口组的最细一层（循环） */
function stepGroup(stack: HoverStack, index: number, delta: number): number {
  const starts = stack.groupStarts
  if (starts.length <= 1) return index
  let current = 0
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]
    if (start !== undefined && start <= index) current = i
  }
  const next = (current + delta + starts.length) % starts.length
  return starts[next] ?? index
}

/** 光标只在桌面上时没有可用候选（整屏不算吸附目标） */
function hasRealCandidate(stack: HoverStack): boolean {
  return stack.levels.some(function (region) {
    return region.kind !== 'screen'
  })
}

export { buildRegionIndex, findHoverStack, hasRealCandidate, stepGroup, stepLevel }
export type { CaptureRegion, HoverStack, RegionIndex, RegionKind }
