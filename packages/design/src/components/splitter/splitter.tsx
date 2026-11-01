import { cn } from 'cn'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'

import { parseChildren } from './parse-children'
import { SplitterHandleView } from './splitter-handle'
import { SplitterPaneView } from './splitter-pane'
import {
  autoPtgSizes,
  limitPtgSizes,
  ptgToLayoutPct,
  sizeToPtg
} from './size-util'
import type {
  GroupHandle,
  HandleItem,
  LayoutChangeMeta,
  PaneHandle,
  PaneItem,
  SizeValue,
  SplitterProps
} from './types'

const COLLAPSED_EPS_PX = 0.5

function assignPaneRef(
  paneRef: PaneItem['paneRef'],
  handle: PaneHandle | null
) {
  if (!paneRef) return
  if (typeof paneRef === 'function') {
    paneRef(handle)
    return
  }
  paneRef.current = handle
}

function Splitter(props: SplitterProps) {
  const {
    id,
    orientation = 'horizontal',
    className,
    style,
    children,
    groupRef,
    defaultLayout,
    onLayoutChanged,
    onCollapse,
    disabled = false,
    freezeTransition = false,
    collapseIcon
  } = props

  const isVertical = orientation === 'vertical'
  // 每帧解析：占位 Pane 的 children 必须是最新 VNode，不能 memo 冻住
  const { panes, handles } = parseChildren(children)

  const paneIdsKey = panes
    .map(function (pane) {
      return pane.id
    })
    .join('\0')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerPx, updateContainerPx] = useState(0)
  const [ptgSizes, updatePtgSizes] = useState<number[]>([])
  const [isDragging, updateDragging] = useState(false)
  const [activeHandle, updateActiveHandle] = useState<number | null>(null)
  const [hoveredHandle, updateHoveredHandle] = useState<number | null>(null)
  const [isAnimating, updateAnimating] = useState(false)

  const dragCacheRef = useRef<number[] | null>(null)
  const dragStartPosRef = useRef<number>(0)
  const movingIndexRef = useRef<{ index: number; confirmed: boolean } | null>(
    null
  )
  const collapsedCacheRef = useRef<Record<string, number>>({})
  const pxSnapshotRef = useRef<Record<string, number>>({})
  const panesRef = useRef(panes)
  panesRef.current = panes
  const ptgSizesRef = useRef(ptgSizes)
  ptgSizesRef.current = ptgSizes
  const containerPxRef = useRef(containerPx)
  containerPxRef.current = containerPx
  const onLayoutChangedRef = useRef(onLayoutChanged)
  onLayoutChangedRef.current = onLayoutChanged
  const onCollapseRef = useRef(onCollapse)
  onCollapseRef.current = onCollapse
  const animateTimerRef = useRef<number | null>(null)
  const defaultLayoutRef = useRef(defaultLayout)
  defaultLayoutRef.current = defaultLayout

  const handleCount = Math.max(0, panes.length - 1)
  const mergedHandles: HandleItem[] = []
  for (let i = 0; i < handleCount; i += 1) {
    mergedHandles.push(
      handles[i] ?? {
        withHandle: false,
        disabled: false,
        disableDoubleClick: false
      }
    )
  }

  function findCollapsedFlags(ptgs: number[], px: number): boolean[] {
    return panesRef.current.map(function (pane, index) {
      const sizePx = (ptgs[index] ?? 0) * px
      return sizePx <= pane.collapsedSize + COLLAPSED_EPS_PX
    })
  }

  function findLayoutFromPtg(ptgs: number[]): Record<string, number> {
    const pcts = ptgToLayoutPct(ptgs)
    const layout: Record<string, number> = {}
    panesRef.current.forEach(function (pane, index) {
      layout[pane.id] = pcts[index] ?? 0
    })
    return layout
  }

  function emitLayout(ptgs: number[], meta?: LayoutChangeMeta) {
    onLayoutChangedRef.current?.(findLayoutFromPtg(ptgs), meta)
  }

  function emitCollapse(ptgs: number[]) {
    const notify = onCollapseRef.current
    if (!notify) return
    const collapsed: Record<string, boolean> = {}
    const flags = findCollapsedFlags(ptgs, containerPxRef.current)
    panesRef.current.forEach(function (pane, index) {
      collapsed[pane.id] = flags[index] ?? false
    })
    notify(collapsed, findLayoutFromPtg(ptgs))
  }

  function isSamePtg(left: number[], right: number[]): boolean {
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (Math.abs((left[i] ?? 0) - (right[i] ?? 0)) > 1e-6) return false
    }
    return true
  }

  function findMinMaxPtg(pane: PaneItem, px: number) {
    const min = sizeToPtg(pane.min, px) ?? 0
    const max = sizeToPtg(pane.max, px) ?? 1
    return { min, max }
  }

  function bootstrapSizes(px: number): number[] {
    const currentPanes = panesRef.current
    if (currentPanes.length === 0 || px <= 0) return []

    const layout = defaultLayoutRef.current
    const fromLayout: (number | undefined)[] = currentPanes.map(function (pane) {
      const stored = layout?.[pane.id]
      if (typeof stored === 'number' && Number.isFinite(stored)) {
        return stored / 100
      }
      return sizeToPtg(pane.defaultSize, px)
    })

    const mins = currentPanes.map(function (pane) {
      return findMinMaxPtg(pane, px).min
    })
    const maxes = currentPanes.map(function (pane) {
      return findMinMaxPtg(pane, px).max
    })

    // 折叠态：layout 里接近 0 的保持 0
    const collapsedFlags = fromLayout.map(function (size, index) {
      if (size === undefined) return false
      return size * px <= currentPanes[index]!.collapsedSize + COLLAPSED_EPS_PX
    })

    let next = autoPtgSizes(fromLayout, mins, maxes)
    next = limitPtgSizes(next, mins, collapsedFlags)
    // 强制折叠档位
    next = next.map(function (size, index) {
      if (!collapsedFlags[index]) return size
      return currentPanes[index]!.collapsedSize / px
    })
    return next
  }

  function reclampOnContainerResize(prevPtgs: number[], nextPx: number, prevPx: number) {
    const currentPanes = panesRef.current
    if (currentPanes.length === 0 || nextPx <= 0) return prevPtgs

    const collapsedFlags = findCollapsedFlags(prevPtgs, prevPx || nextPx)
    let next = [...prevPtgs]

    // preservePixel：按上次像素宽换算新比例
    const preservedPx: (number | undefined)[] = currentPanes.map(function (pane, index) {
      if (!pane.preservePixel || collapsedFlags[index]) return undefined
      const snap = pxSnapshotRef.current[pane.id]
      if (typeof snap === 'number') return snap
      return prevPtgs[index]! * (prevPx || nextPx)
    })

    const hasPreserve = preservedPx.some(function (value) {
      return value !== undefined
    })
    if (hasPreserve) {
      const explicit: (number | undefined)[] = preservedPx.map(function (pxSize, index) {
        if (collapsedFlags[index]) {
          return currentPanes[index]!.collapsedSize / nextPx
        }
        if (pxSize === undefined) return undefined
        return pxSize / nextPx
      })
      const mins = currentPanes.map(function (pane, index) {
        return collapsedFlags[index] ? 0 : findMinMaxPtg(pane, nextPx).min
      })
      const maxes = currentPanes.map(function (pane, index) {
        return collapsedFlags[index] ? 0 : findMinMaxPtg(pane, nextPx).max
      })
      next = autoPtgSizes(explicit, mins, maxes)
    } else {
      const mins = currentPanes.map(function (pane, index) {
        return collapsedFlags[index] ? 0 : findMinMaxPtg(pane, nextPx).min
      })
      next = limitPtgSizes(next, mins, collapsedFlags)
      // 折叠栏钉住 collapsedSize
      next = next.map(function (size, index) {
        if (!collapsedFlags[index]) return size
        return currentPanes[index]!.collapsedSize / nextPx
      })
      const maxes = currentPanes.map(function (pane, index) {
        return collapsedFlags[index] ? 0 : findMinMaxPtg(pane, nextPx).max
      })
      next = autoPtgSizes(
        next.map(function (size) {
          return size
        }),
        mins,
        maxes
      )
      next = next.map(function (size, index) {
        if (!collapsedFlags[index]) return size
        return currentPanes[index]!.collapsedSize / nextPx
      })
    }

    currentPanes.forEach(function (pane, index) {
      if (pane.preservePixel && !collapsedFlags[index]) {
        pxSnapshotRef.current[pane.id] = next[index]! * nextPx
      }
    })

    return next
  }

  // 容器尺寸
  useLayoutEffect(
    function () {
      const node = containerRef.current
      if (!node || typeof ResizeObserver === 'undefined') return

      function sync() {
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const nextPx = isVertical ? rect.height : rect.width
        if (nextPx <= 0) return

        updateContainerPx(function (prevPx) {
          if (Math.abs(prevPx - nextPx) < 0.5) return prevPx

          updatePtgSizes(function (prevPtgs) {
            if (prevPtgs.length === 0 || prevPtgs.length !== panesRef.current.length) {
              return bootstrapSizes(nextPx)
            }
            return reclampOnContainerResize(prevPtgs, nextPx, prevPx)
          })
          return nextPx
        })
      }

      sync()
      const observer = new ResizeObserver(sync)
      observer.observe(node)
      return function () {
        observer.disconnect()
      }
    },
    [isVertical, paneIdsKey]
  )

  // pane 增删时重建
  useEffect(
    function () {
      if (containerPx <= 0) return
      updatePtgSizes(function (prev) {
        if (prev.length === panes.length) return prev
        return bootstrapSizes(containerPx)
      })
    },
    [paneIdsKey, containerPx, panes.length]
  )

  function writePtgSizes(
    next: number[],
    meta?: LayoutChangeMeta,
    animate = false,
    options?: { notifyResize?: boolean; emitLayoutEvent?: boolean }
  ) {
    const shouldEmit = options?.emitLayoutEvent !== false
    if (isSamePtg(next, ptgSizesRef.current)) return
    if (animate) {
      updateAnimating(true)
      if (animateTimerRef.current !== null) {
        window.clearTimeout(animateTimerRef.current)
      }
      animateTimerRef.current = window.setTimeout(function () {
        animateTimerRef.current = null
        updateAnimating(false)
      }, 200)
    }
    updatePtgSizes(next)
    ptgSizesRef.current = next
    const flags = findCollapsedFlags(next, containerPxRef.current)
    const shouldNotifyResize = options?.notifyResize !== false
    panesRef.current.forEach(function (pane, index) {
      if (pane.preservePixel && !flags[index]) {
        pxSnapshotRef.current[pane.id] = next[index]! * containerPxRef.current
      }
      // 拖拽跟手帧不打 onResize，避免业务层每帧同步开合 / 重渲染
      if (shouldNotifyResize) pane.onResize?.()
    })
    if (shouldEmit) emitLayout(next, meta)
  }

  function collapsePane(index: number, animate = true) {
    const px = containerPxRef.current
    const currentPanes = panesRef.current
    const pane = currentPanes[index]
    if (!pane || px <= 0) return

    const current = [...ptgSizesRef.current]
    const sizePx = current[index]! * px
    if (sizePx <= pane.collapsedSize + COLLAPSED_EPS_PX) return

    collapsedCacheRef.current[pane.id] = sizePx
    const collapsedPtg = pane.collapsedSize / px
    const freed = current[index]! - collapsedPtg
    current[index] = collapsedPtg

    // 把余量给相邻非折叠栏（优先右侧/下方）
    let target = index + 1 < current.length ? index + 1 : index - 1
    if (target < 0) target = 0
    current[target] = (current[target] ?? 0) + freed

    // 折叠不标 userInteraction：避免把 0 写进「展开偏好」存档
    writePtgSizes(current, { isUserInteraction: false }, animate)
    emitCollapse(current)
  }

  function expandPane(index: number, animate = true) {
    const px = containerPxRef.current
    const currentPanes = panesRef.current
    const pane = currentPanes[index]
    if (!pane || px <= 0) return

    const current = [...ptgSizesRef.current]
    const sizePx = current[index]! * px
    if (sizePx > pane.collapsedSize + COLLAPSED_EPS_PX) return

    const cached = collapsedCacheRef.current[pane.id]
    const minPtg = findMinMaxPtg(pane, px).min
    const maxPtg = findMinMaxPtg(pane, px).max
    let restorePtg =
      typeof cached === 'number' && cached > pane.collapsedSize
        ? cached / px
        : minPtg > 0
          ? minPtg
          : Math.min(0.2, maxPtg)
    restorePtg = Math.min(maxPtg, Math.max(minPtg, restorePtg))
    if (restorePtg <= pane.collapsedSize / px + 1e-6) {
      restorePtg = Math.max(minPtg, 0.15)
    }

    let need = restorePtg - current[index]!
    if (need <= 0) return

    // 从所有其它「未折叠且高于 min」的栏按可让出量比例借用，避免单邻栏触 min 导致展开失败
    const donors: { index: number; available: number }[] = []
    let totalAvailable = 0
    for (let i = 0; i < currentPanes.length; i += 1) {
      if (i === index) continue
      const other = currentPanes[i]!
      const otherMin =
        current[i]! * px <= other.collapsedSize + COLLAPSED_EPS_PX
          ? 0
          : findMinMaxPtg(other, px).min
      const available = Math.max(0, current[i]! - otherMin)
      if (available > 1e-6) {
        donors.push({ index: i, available })
        totalAvailable += available
      }
    }

    if (totalAvailable <= 1e-6) {
      // 实在借不到：压缩其它栏到 collapsed/min，硬展开
      for (let i = 0; i < current.length; i += 1) {
        if (i === index) continue
        const other = currentPanes[i]!
        current[i] =
          current[i]! * px <= other.collapsedSize + COLLAPSED_EPS_PX
            ? other.collapsedSize / px
            : findMinMaxPtg(other, px).min
      }
      const used = current.reduce(function (sum, value, i) {
        return i === index ? sum : sum + value
      }, 0)
      current[index] = Math.max(0, 1 - used)
    } else {
      const takeTotal = Math.min(need, totalAvailable)
      for (const donor of donors) {
        const share = (donor.available / totalAvailable) * takeTotal
        current[donor.index] -= share
      }
      current[index] += takeTotal
    }

    writePtgSizes(current, { isUserInteraction: false }, animate)
    emitCollapse(current)
  }

  function resizePane(index: number, size: SizeValue) {
    const px = containerPxRef.current
    const currentPanes = panesRef.current
    if (!currentPanes[index] || px <= 0) return
    const targetPtg = sizeToPtg(size, px)
    if (targetPtg === undefined) return

    const current = [...ptgSizesRef.current]
    const { min, max } = findMinMaxPtg(currentPanes[index]!, px)
    const nextPtg = Math.min(max, Math.max(min, targetPtg))
    const delta = nextPtg - current[index]!
    let donor = index + 1 < current.length ? index + 1 : index - 1
    if (donor < 0) donor = 0
    const donorMin = findMinMaxPtg(currentPanes[donor]!, px).min
    if (delta > 0) {
      const available = Math.max(0, current[donor]! - donorMin)
      const take = Math.min(delta, available)
      current[donor] -= take
      current[index] += take
    } else {
      current[index] += delta
      current[donor] -= delta
    }
    writePtgSizes(current, { isUserInteraction: false }, false)
  }

  // 命令式 pane refs：只随栏位身份变化重建，方法内读 ref，避免拖拽每帧换 handle 对象
  useLayoutEffect(
    function () {
      const currentPanes = panesRef.current
      currentPanes.forEach(function (pane, index) {
        const handle: PaneHandle = {
          collapse() {
            collapsePane(index, true)
          },
          expand() {
            expandPane(index, true)
          },
          isCollapsed() {
            const live = panesRef.current[index]
            if (!live) return true
            const px = containerPxRef.current
            const sizePx = (ptgSizesRef.current[index] ?? 0) * px
            return sizePx <= live.collapsedSize + COLLAPSED_EPS_PX
          },
          resize(size) {
            resizePane(index, size)
          },
          findSize() {
            const px = containerPxRef.current
            const ptg = ptgSizesRef.current[index] ?? 0
            return { inPixels: ptg * px, inPercentage: ptg * 100 }
          }
        }
        assignPaneRef(pane.paneRef, handle)
      })
      return function () {
        panesRef.current.forEach(function (pane) {
          assignPaneRef(pane.paneRef, null)
        })
        if (animateTimerRef.current !== null) {
          window.clearTimeout(animateTimerRef.current)
          animateTimerRef.current = null
        }
      }
    },
    [paneIdsKey]
  )

  useImperativeHandle(
    groupRef,
    function (): GroupHandle {
      return {
        setLayout(layout) {
          const px = containerPxRef.current
          if (px <= 0) return
          const currentPanes = panesRef.current
          const next = currentPanes.map(function (pane, index) {
            const value = layout[pane.id]
            if (typeof value === 'number' && Number.isFinite(value)) {
              return Math.max(0, value / 100)
            }
            return ptgSizesRef.current[index] ?? 0
          })
          const sum = next.reduce(function (a, b) {
            return a + b
          }, 0)
          if (sum <= Number.EPSILON) {
            writePtgSizes(bootstrapSizes(px), { isUserInteraction: false }, false)
            return
          }
          // 按比例归一，但保留「本意折叠」的 0（不因归一被抬成非 0）
          const normalized = next.map(function (value) {
            if (value <= Number.EPSILON) return 0
            return value / sum
          })
          const normSum = normalized.reduce(function (a, b) {
            return a + b
          }, 0)
          if (normSum > Number.EPSILON && Math.abs(normSum - 1) > 1e-6) {
            const scale = 1 / normSum
            for (let i = 0; i < normalized.length; i += 1) {
              if (normalized[i]! > 0) normalized[i]! *= scale
            }
          }
          writePtgSizes(normalized, { isUserInteraction: false }, false)
        },
        findLayout() {
          return findLayoutFromPtg(ptgSizesRef.current)
        }
      }
    },
    [paneIdsKey]
  )

  const onOffsetUpdate = useCallback(function (handleIndex: number, offsetPx: number) {
    const px = containerPxRef.current
    const cache = dragCacheRef.current
    const currentPanes = panesRef.current
    if (!cache || px <= 0) return

    let moving = movingIndexRef.current
    if ((!moving || !moving.confirmed) && offsetPx !== 0) {
      if (offsetPx > 0) {
        moving = { index: handleIndex, confirmed: true }
      } else {
        let confirmed = handleIndex
        for (let i = handleIndex; i >= 0; i -= 1) {
          if (cache[i]! > currentPanes[i]!.collapsedSize + COLLAPSED_EPS_PX) {
            confirmed = i
            break
          }
        }
        moving = { index: confirmed, confirmed: true }
      }
      movingIndexRef.current = moving
    }

    const mergedIndex = moving?.index ?? handleIndex
    const nextIndex = mergedIndex + 1
    if (nextIndex >= currentPanes.length) return

    // 已折叠栏：拖拽不改其尺寸（不通过拖拽展开/折叠）
    const startCollapsed =
      cache[mergedIndex]! <= currentPanes[mergedIndex]!.collapsedSize + COLLAPSED_EPS_PX
    const endCollapsed =
      cache[nextIndex]! <= currentPanes[nextIndex]!.collapsedSize + COLLAPSED_EPS_PX
    if (startCollapsed || endCollapsed) return

    const startMin = (sizeToPtg(currentPanes[mergedIndex]!.min, px) ?? 0) * px
    const endMin = (sizeToPtg(currentPanes[nextIndex]!.min, px) ?? 0) * px
    const startMax = (sizeToPtg(currentPanes[mergedIndex]!.max, px) ?? 1) * px
    const endMax = (sizeToPtg(currentPanes[nextIndex]!.max, px) ?? 1) * px

    const numSizes = [...cache]
    let mergedOffset = offsetPx

    if (numSizes[mergedIndex]! + mergedOffset < startMin) {
      mergedOffset = startMin - numSizes[mergedIndex]!
    }
    if (numSizes[nextIndex]! - mergedOffset < endMin) {
      mergedOffset = numSizes[nextIndex]! - endMin
    }
    if (numSizes[mergedIndex]! + mergedOffset > startMax) {
      mergedOffset = startMax - numSizes[mergedIndex]!
    }
    if (numSizes[nextIndex]! - mergedOffset > endMax) {
      mergedOffset = numSizes[nextIndex]! - endMax
    }

    numSizes[mergedIndex]! += mergedOffset
    numSizes[nextIndex]! -= mergedOffset

    const nextPtg = numSizes.map(function (size) {
      return size / px
    })
    // 跟手帧：只改尺寸；onResize / onLayoutChanged 留到 pointerup，避免每帧落盘
    writePtgSizes(nextPtg, undefined, false, {
      notifyResize: false,
      emitLayoutEvent: false
    })
  }, [])

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>, index: number) {
    if (disabled || mergedHandles[index]?.disabled) return
    if (!panes[index]?.resizable || !panes[index + 1]?.resizable) return

    event.preventDefault()
    const px = containerPxRef.current
    dragCacheRef.current = ptgSizesRef.current.map(function (ptg) {
      return ptg * px
    })
    dragStartPosRef.current = isVertical ? event.clientY : event.clientX
    movingIndexRef.current = { index, confirmed: false }
    updateDragging(true)
    updateActiveHandle(index)

    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
  }

  useEffect(
    function () {
      if (!isDragging) return

      function onMove(event: PointerEvent) {
        const start = dragStartPosRef.current
        const offset = (isVertical ? event.clientY : event.clientX) - start
        const index = movingIndexRef.current?.index ?? activeHandle
        if (index === null || index === undefined) return
        onOffsetUpdate(index, offset)
      }

      function onUp() {
        // 松手：补一帧带 onResize 的布局通知，供业务落盘 / 同步
        emitLayout(ptgSizesRef.current, { isUserInteraction: true })
        panesRef.current.forEach(function (pane) {
          pane.onResize?.()
        })
        updateDragging(false)
        updateActiveHandle(null)
        dragCacheRef.current = null
        movingIndexRef.current = null
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      window.addEventListener('blur', onUp)
      return function () {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        window.removeEventListener('blur', onUp)
      }
    },
    [isDragging, isVertical, activeHandle, onOffsetUpdate]
  )

  function findHandleFlagsAt(index: number, collapsedFlags: boolean[]) {
    const prev = panes[index]
    const next = panes[index + 1]
    const prevCollapsed = collapsedFlags[index] ?? false
    const nextCollapsed = collapsedFlags[index + 1] ?? false

    // start 钮：收起 prev，或展开已折叠的 next
    const prevEnd = Boolean(prev?.collapsible.end) && !prevCollapsed
    const nextStartExpand = Boolean(next?.collapsible.start) && nextCollapsed
    const startCollapsible = prevEnd || nextStartExpand
    // start 钮处于「展开」语义时（点下去会展开 next）
    const startIsExpand = nextStartExpand

    // end 钮：收起 next，或展开已折叠的 prev
    const nextStart = Boolean(next?.collapsible.start) && !nextCollapsed
    const prevEndExpand = Boolean(prev?.collapsible.end) && prevCollapsed
    const endCollapsible = nextStart || prevEndExpand
    const endIsExpand = prevEndExpand

    const canResize =
      Boolean(prev?.resizable) &&
      Boolean(next?.resizable) &&
      !prevCollapsed &&
      !nextCollapsed &&
      !disabled &&
      !mergedHandles[index]?.disabled

    return {
      startCollapsible,
      endCollapsible,
      startCollapsed: startIsExpand,
      endCollapsed: endIsExpand,
      canResize
    }
  }

  function onCollapseSide(handleIndex: number, side: 'start' | 'end') {
    const collapsedFlags = findCollapsedFlags(ptgSizes, containerPx)
    const prev = panes[handleIndex]
    const next = panes[handleIndex + 1]
    const prevCollapsed = collapsedFlags[handleIndex] ?? false
    const nextCollapsed = collapsedFlags[handleIndex + 1] ?? false

    if (side === 'start') {
      // 收起左侧/上侧栏
      if (!prevCollapsed && prev?.collapsible.end) {
        collapsePane(handleIndex, true)
        return
      }
      // 展开右侧/下侧栏（它朝本把手折叠）
      if (nextCollapsed && next?.collapsible.start) {
        expandPane(handleIndex + 1, true)
      }
      return
    }

    // 收起右侧/下侧栏
    if (!nextCollapsed && next?.collapsible.start) {
      collapsePane(handleIndex + 1, true)
      return
    }
    // 展开左侧/上侧栏（它朝本把手折叠）
    if (prevCollapsed && prev?.collapsible.end) {
      expandPane(handleIndex, true)
    }
  }

  const stackSizes = useMemo(
    function () {
      const merged: number[] = []
      let stack = 0
      for (let i = 0; i < ptgSizes.length; i += 1) {
        stack += ptgSizes[i] ?? 0
        merged.push(stack)
      }
      return merged
    },
    [ptgSizes]
  )

  return (
    <div
      id={id}
      ref={containerRef}
      data-slot="splitter"
      data-splitter-dragging={isDragging || freezeTransition || undefined}
      data-orientation={orientation}
      className={cn(
        'flex h-full w-full',
        isVertical ? 'flex-col' : 'flex-row',
        className
      )}
      style={style}>
      {renderSplitterChildren()}

      {isDragging && (
        <div
          data-slot="splitter-mask"
          className="fixed inset-0 z-50"
          style={{ cursor: isVertical ? 'row-resize' : 'col-resize' }}
        />
      )}
    </div>
  )

  function renderSplitterChildren() {
    const collapsedFlags = findCollapsedFlags(ptgSizes, containerPx)
    const nodes: ReactNode[] = []

    for (let index = 0; index < panes.length; index += 1) {
      const pane = panes[index]!
      const ptg = ptgSizes[index] ?? 0
      nodes.push(
        <SplitterPaneView
          key={pane.id}
          id={pane.id}
          className={pane.className}
          style={pane.style}
          flexBasisPct={ptg * 100}
          isCollapsed={collapsedFlags[index] ?? false}
          destroyOnHidden={pane.destroyOnHidden}
          isAnimating={isAnimating && !isDragging && !freezeTransition}>
          {pane.children}
        </SplitterPaneView>
      )

      if (index >= mergedHandles.length) continue
      const handle = mergedHandles[index]!
      const handleFlags = findHandleFlagsAt(index, collapsedFlags)
      const prevStack = index === 0 ? 0 : (stackSizes[index - 1] ?? 0)
      const nextMin = sizeToPtg(panes[index + 1]?.min, containerPx) ?? 0
      nodes.push(
        <SplitterHandleView
          key={`handle-${pane.id}`}
          index={index}
          orientation={orientation}
          withHandle={handle.withHandle}
          className={handle.className}
          disabled={handle.disabled || disabled}
          disableDoubleClick={handle.disableDoubleClick}
          isActive={activeHandle === index}
          isHovered={hoveredHandle === index}
          ariaNow={prevStack * 100 + ptg * 100}
          ariaMin={prevStack * 100}
          ariaMax={((stackSizes[index + 1] ?? 1) - nextMin) * 100}
          canResize={handleFlags.canResize}
          startCollapsible={handleFlags.startCollapsible}
          endCollapsible={handleFlags.endCollapsible}
          startCollapsed={handleFlags.startCollapsed}
          endCollapsed={handleFlags.endCollapsed}
          collapseConfig={handle.collapse}
          collapseIcon={collapseIcon}
          onPointerDown={handlePointerDown}
          onPointerEnter={function () {
            updateHoveredHandle(index)
          }}
          onPointerLeave={function () {
            updateHoveredHandle(function (current) {
              return current === index ? null : current
            })
          }}
          onCollapseStart={function () {
            onCollapseSide(index, 'start')
          }}
          onCollapseEnd={function () {
            onCollapseSide(index, 'end')
          }}
        />
      )
    }

    return nodes
  }
}

export { Splitter }
