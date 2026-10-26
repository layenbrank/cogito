import type Konva from 'konva'
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import { v4 as UUID } from 'uuid'

import type { AnnotationHandle } from '@/features/capture/components/annotation'
import { type GraphicsEnum, type GraphicsProps } from '@/features/capture/components/graphics'
import {
  MIN_DRAG_PX,
  MULTI_POINT_GRAPHICS,
  POINT_SHAPES,
  RATIO_GRAPHICS,
  clampPointToSelection,
  constrainRatioPoint,
  type Point
} from '@/features/capture/capture-selection'
import { createHoverProbe, type HoverProbe } from '@/features/capture/hover-probe'
import {
  buildRegionIndex,
  findHoverStack,
  hasRealCandidate,
  stepGroup,
  stepLevel,
  type CaptureRegion,
  type HoverStack,
  type RegionIndex
} from '@/features/capture/region'

type StageEvent = Konva.KonvaEventObject<MouseEvent>
type Phase = 'selecting' | 'annotating' | 'editing'
type Selection = (Point & { w: number; h: number }) | null
type ApplyHover = (pt: Point, keepIndex: boolean) => void

interface UseCaptureStageOptions {
  phase: Phase
  graphics: GraphicsEnum | null
  annotations: GraphicsProps[]
  selection: Selection
  color: string
  thickness: number
  filled: boolean
  opacity: number
  fontSize: number
  isWindowDetect: boolean
  /** 元素级吸附（UI Automation）；关闭时只用窗口/子控件矩形 */
  isElementDetect: boolean
  /** 查询光标下的元素链；失败返回空数组 */
  probeElements?: (x: number, y: number) => Promise<CaptureRegion[]>
  annotationRef: RefObject<AnnotationHandle | null>
  onUpdateAnnotations: Dispatch<SetStateAction<GraphicsProps[]>>
  onUpdateSelection: Dispatch<SetStateAction<Selection>>
  onUpdatePhase: (phase: Phase) => void
  commitHistory: (next: GraphicsProps[]) => void
}

interface CaptureStageApi {
  regionsRef: RefObject<CaptureRegion[]>
  /** 当前悬停候选的描述（控件类型 / 窗口标题），给尺寸角标用 */
  hoverLabel: string
  handlePress(this: void, event: StageEvent): void
  handleMove(this: void, event: StageEvent): void
  handleRelease(this: void, event: StageEvent): void
  /** 滚轮换层 / Shift+滚轮换窗口；返回是否消费了事件 */
  handleWheel(this: void, deltaY: number, shiftKey: boolean): boolean
  resetDragState(this: void): void
}

/** 浮层窗口正好铺满屏幕，所以视口尺寸就是整屏逻辑尺寸 */
function readScreenSize() {
  return { w: window.innerWidth, h: window.innerHeight }
}

function useCaptureStage(options: UseCaptureStageOptions): CaptureStageApi {
  const [hoverLabel, setHoverLabel] = useState('')
  const draftIDRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)
  const isPressedRef = useRef(false)
  const cancelledRef = useRef(false)
  const hasMovedRef = useRef(false)
  const beginRef = useRef<Point>({ x: 0, y: 0 })
  const pointerRef = useRef<Point | null>(null)
  const regionsRef = useRef<CaptureRegion[]>([])
  const elementsRef = useRef<CaptureRegion[]>([])
  const hoverStackRef = useRef<HoverStack | null>(null)
  const hoverIndexRef = useRef(0)
  const stackKeyRef = useRef('')
  const snapCandidateRef = useRef<CaptureRegion | null>(null)
  const lastAppliedRef = useRef('')
  const optionsRef = useRef(options)
  const applyHoverRef = useRef<ApplyHover>(function () {})
  const probeRef = useRef<HoverProbe | null>(null)
  const screenSizeRef = useRef(readScreenSize())
  const indexRef = useRef<RegionIndex>({ groups: [] })
  const indexedRef = useRef<CaptureRegion[] | null>(null)

  function readPointer(event: StageEvent): Point | null {
    const stage = event.target.getStage()
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    const point = { x: pos.x, y: pos.y }
    pointerRef.current = point
    return point
  }

  function resolveStack(pt: Point): HoverStack {
    const regions = regionsRef.current
    if (indexedRef.current !== regions) {
      indexedRef.current = regions
      indexRef.current = buildRegionIndex(regions)
    }
    return findHoverStack(indexRef.current, elementsRef.current, pt.x, pt.y, screenSizeRef.current)
  }

  /** 悬停选中：矩形没变就不触发重渲染（mousemove 频率下这很关键） */
  function applySelection(candidate: CaptureRegion | null) {
    const key = candidate
      ? `${candidate.x},${candidate.y},${candidate.w},${candidate.h}`
      : ''
    if (key === lastAppliedRef.current) return
    lastAppliedRef.current = key
    options.onUpdateSelection(candidate)
  }

  /** 候选的描述文案：元素看控件类型 + 名称，窗口看标题 */
  function describe(region: CaptureRegion | null): string {
    if (!region) return ''
    if (region.kind === 'screen') return '整屏'
    const title = (region.title ?? '').trim()
    const type = (region.control_type ?? '').trim()
    const text =
      region.kind === 'element'
        ? type && title
          ? `${type} · ${title}`
          : type || title
        : title || (region.kind === 'child' ? type : '')
    return text.length > 22 ? `${text.slice(0, 22)}…` : text
  }

  /** 应用候选栈当前层；`keepIndex` 为真时保留用户滚轮选定的层 */
  function applyHover(pt: Point, keepIndex: boolean) {
    const stack = resolveStack(pt)
    const first = stack.levels[0]
    const key = first ? `${first.kind ?? ''}:${first.x}:${first.y}:${first.w}:${first.h}` : ''
    // 候选集合变了（换到了别的窗口/元素）就回到最细一层
    if (!keepIndex || key !== stackKeyRef.current) {
      stackKeyRef.current = key
      hoverIndexRef.current = 0
    }
    hoverStackRef.current = stack
    const index = Math.min(hoverIndexRef.current, Math.max(stack.levels.length - 1, 0))
    hoverIndexRef.current = index
    const candidate = hasRealCandidate(stack) ? (stack.levels[index] ?? null) : null
    setHoverLabel(describe(candidate))
    applySelection(candidate)
  }

  // options / applyHover 通过 ref 透传给探测回调，避免每次渲染重建调度器
  useEffect(function () {
    optionsRef.current = options
    applyHoverRef.current = applyHover
  })

  // 视口尺寸缓存：窗口铺满屏幕，只有 resize 才会变
  useEffect(function () {
    function readSize() {
      screenSizeRef.current = readScreenSize()
    }
    readSize()
    window.addEventListener('resize', readSize)
    return function () {
      window.removeEventListener('resize', readSize)
    }
  }, [])

  // 探测调度器只创建一次；停住才探测，移动过程中不做光标穿透
  useEffect(function () {
    const probe = createHoverProbe({
      probe: function (x, y) {
        const find = optionsRef.current.probeElements
        return find ? find(x, y) : Promise.resolve([])
      },
      onResult: function (chain) {
        elementsRef.current = chain
        const latest = pointerRef.current
        if (latest && optionsRef.current.phase === 'selecting' && !isDraggingRef.current) {
          applyHoverRef.current(latest, true)
        }
      }
    })
    probeRef.current = probe
    return function () {
      probe.dispose()
      probeRef.current = null
    }
  }, [])

  // 关掉元素检测时清掉残留的元素链
  useEffect(
    function () {
      if (options.isElementDetect) return
      elementsRef.current = []
      probeRef.current?.cancel()
    },
    [options.isElementDetect]
  )

  /** 请求一次元素级细化（节流与收敛都在调度器里） */
  function requestProbe(pt: Point) {
    if (!options.isElementDetect) return
    const stack = hoverStackRef.current
    if (!stack || !hasRealCandidate(stack)) return
    probeRef.current?.request(pt)
  }

  function handlePress(event: StageEvent) {
    const pt = readPointer(event)
    if (!pt) return

    if (options.phase === 'editing') return

    const clickedOnEmpty = event.target === event.target.getStage()
    if (options.phase === 'annotating' && !clickedOnEmpty) return

    // 按下即停掉探测：穿透会让拖拽丢事件
    probeRef.current?.cancel()

    isPressedRef.current = true
    beginRef.current = pt
    isDraggingRef.current = true
    hasMovedRef.current = false

    if (options.phase === 'selecting') {
      // 单击直接采用「当前悬停层」（滚轮可能已经换过层）；关闭检测时不吸附
      if (!options.isWindowDetect && !options.isElementDetect) {
        snapCandidateRef.current = null
        return
      }
      const stack = resolveStack(pt)
      hoverStackRef.current = stack
      const index = Math.min(hoverIndexRef.current, Math.max(stack.levels.length - 1, 0))
      hoverIndexRef.current = index
      snapCandidateRef.current = hasRealCandidate(stack) ? (stack.levels[index] ?? null) : null
      return
    }

    if (cancelledRef.current) return

    if (!options.selection) return
    const inBounds =
      pt.x >= options.selection.x &&
      pt.x <= options.selection.x + options.selection.w &&
      pt.y >= options.selection.y &&
      pt.y <= options.selection.y + options.selection.h
    if (!inBounds) return

    if (options.phase === 'annotating') {
      if (!options.graphics) return
      const newID = UUID()
      draftIDRef.current = newID
      let nextIndex: number | undefined
      if (options.graphics === 'index') {
        nextIndex =
          options.annotations
            .filter(function (a) {
              return a.type === 'index'
            })
            .reduce(function (max, a) {
              return Math.max(max, a.index ?? 0)
            }, 0) + 1
      }
      options.onUpdateAnnotations(function (prev) {
        return prev.concat([
          {
            id: newID,
            type: options.graphics!,
            color: options.color,
            thickness: options.thickness,
            fontSize: options.fontSize,
            filled: options.filled,
            opacity: options.opacity,
            index: nextIndex,
            points: [{ x: pt.x, y: pt.y }]
          }
        ])
      })
    }
  }

  function handleMove(event: StageEvent) {
    const pt = readPointer(event)
    if (!pt) return

    if (options.phase === 'selecting' && isDraggingRef.current) {
      if (event.evt.buttons === 0) {
        // 按下后拖到窗外松开：收不到 mouseup，这里兜底取消
        isDraggingRef.current = false
        isPressedRef.current = false
        cancelledRef.current = true
        return
      }
      if (
        Math.abs(pt.x - beginRef.current.x) >= MIN_DRAG_PX ||
        Math.abs(pt.y - beginRef.current.y) >= MIN_DRAG_PX
      ) {
        hasMovedRef.current = true
      }
      options.onUpdateSelection({
        x: Math.min(beginRef.current.x, pt.x),
        y: Math.min(beginRef.current.y, pt.y),
        w: Math.abs(pt.x - beginRef.current.x),
        h: Math.abs(pt.y - beginRef.current.y)
      })
      return
    }

    if (options.phase === 'selecting' && (options.isWindowDetect || options.isElementDetect)) {
      applyHover(pt, true)
      requestProbe(pt)
      return
    }

    if (cancelledRef.current) return

    if (options.phase === 'annotating' && draftIDRef.current) {
      if (options.graphics && POINT_SHAPES.has(options.graphics)) return
      let clamped = clampPointToSelection(pt, options.selection)
      if (options.graphics && RATIO_GRAPHICS.has(options.graphics)) {
        clamped = constrainRatioPoint(beginRef.current, clamped, event.evt.shiftKey)
        clamped = clampPointToSelection(clamped, options.selection)
      }
      const draftID = draftIDRef.current
      options.onUpdateAnnotations(function (prev) {
        return prev.map(function (value) {
          if (value.id !== draftID) return value
          if (MULTI_POINT_GRAPHICS.has(value.type)) {
            return {
              ...value,
              points: value.points.concat([{ x: clamped.x, y: clamped.y }])
            }
          }
          return {
            ...value,
            points: [value.points[0], { x: clamped.x, y: clamped.y }]
          }
        })
      })
    }
  }

  function handleRelease(event: StageEvent) {
    const pt = readPointer(event)
    if (!pt) return

    const pressed = isPressedRef.current
    const moved = hasMovedRef.current
    isPressedRef.current = false
    isDraggingRef.current = false
    cancelledRef.current = false
    hasMovedRef.current = false

    // 没按下过（例如遮罩刚出现时按下发生在遮罩之外）→ 不能凭空生成选区
    if (!pressed && options.phase === 'selecting') return

    const dx = pt.x - beginRef.current.x
    const dy = pt.y - beginRef.current.y
    const tooSmall = Math.abs(dx) < MIN_DRAG_PX && Math.abs(dy) < MIN_DRAG_PX

    if (options.phase === 'selecting') {
      if (tooSmall) {
        const snap = snapCandidateRef.current
        snapCandidateRef.current = null
        if (snap) {
          options.onUpdateSelection(snap)
          options.onUpdatePhase('editing')
          return
        }
        options.onUpdateSelection(null)
        return
      }
      snapCandidateRef.current = null
      options.onUpdateSelection({
        x: Math.min(beginRef.current.x, pt.x),
        y: Math.min(beginRef.current.y, pt.y),
        w: Math.abs(dx),
        h: Math.abs(dy)
      })
      options.onUpdatePhase('editing')
      return
    }

    if (options.phase === 'annotating' && draftIDRef.current) {
      const draftID = draftIDRef.current
      draftIDRef.current = null

      const isSinglePoint = options.graphics ? POINT_SHAPES.has(options.graphics) : false
      if (!isSinglePoint && tooSmall && !moved) {
        options.onUpdateAnnotations(function (prev) {
          return prev.filter(function (v) {
            return v.id !== draftID
          })
        })
        return
      }

      let clamped = clampPointToSelection(pt, options.selection)
      if (options.graphics && RATIO_GRAPHICS.has(options.graphics)) {
        clamped = constrainRatioPoint(beginRef.current, clamped, event.evt.shiftKey)
        clamped = clampPointToSelection(clamped, options.selection)
      }
      const next = options.annotations.map(function (value) {
        if (value.id !== draftID) return value
        if (isSinglePoint) return value
        if (MULTI_POINT_GRAPHICS.has(value.type)) {
          return {
            ...value,
            points: value.points.concat([{ x: clamped.x, y: clamped.y }])
          }
        }
        return {
          ...value,
          points: [value.points[0], { x: clamped.x, y: clamped.y }]
        }
      })
      options.onUpdateAnnotations(next)
      options.commitHistory(next)
      if (isSinglePoint && options.graphics === 'text') {
        options.annotationRef.current?.startEditing(draftID, '')
      }
    }
  }

  function handleWheel(deltaY: number, shiftKey: boolean): boolean {
    if (options.phase !== 'selecting') return false
    if (!options.isWindowDetect && !options.isElementDetect) return false
    const pt = pointerRef.current
    if (!pt) return false

    const stack = resolveStack(pt)
    if (stack.levels.length <= 1) return false
    hoverStackRef.current = stack

    const current = Math.min(hoverIndexRef.current, stack.levels.length - 1)
    // 向上滚 = 更粗（窗口级），向下滚 = 更细（元素级）
    const delta = deltaY < 0 ? 1 : -1
    const next = shiftKey ? stepGroup(stack, current, delta) : stepLevel(stack, current, delta)
    hoverIndexRef.current = next
    const candidate = hasRealCandidate(stack) ? (stack.levels[next] ?? null) : null
    setHoverLabel(describe(candidate))
    applySelection(candidate)
    return true
  }

  function resetDragState() {
    isDraggingRef.current = false
    isPressedRef.current = false
    cancelledRef.current = false
    hasMovedRef.current = false
    snapCandidateRef.current = null
    lastAppliedRef.current = ''
    setHoverLabel('')
  }

  return {
    regionsRef,
    hoverLabel,
    handlePress,
    handleMove,
    handleRelease,
    handleWheel,
    resetDragState
  }
}

export type { CaptureStageApi, Phase, Selection, UseCaptureStageOptions }
export { useCaptureStage }
