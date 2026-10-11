import type Konva from 'konva'
import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
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
import { findHoverRegion, type CaptureRegion } from '@/features/capture/region'

type StageEvent = Konva.KonvaEventObject<MouseEvent>
type Phase = 'selecting' | 'annotating' | 'editing'
type Selection = (Point & { w: number; h: number }) | null

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
  annotationRef: RefObject<AnnotationHandle | null>
  onUpdateAnnotations: Dispatch<SetStateAction<GraphicsProps[]>>
  onUpdateSelection: Dispatch<SetStateAction<Selection>>
  onUpdatePhase: (phase: Phase) => void
  commitHistory: (next: GraphicsProps[]) => void
}

interface CaptureStageApi {
  regionsRef: RefObject<CaptureRegion[]>
  handlePress(this: void, event: StageEvent): void
  handleMove(this: void, event: StageEvent): void
  handleRelease(this: void, event: StageEvent): void
  resetDragState(this: void): void
}

function useCaptureStage(options: UseCaptureStageOptions): CaptureStageApi {
  const draftIDRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)
  const cancelledRef = useRef(false)
  const hasMovedRef = useRef(false)
  const beginRef = useRef<Point>({ x: 0, y: 0 })
  const regionsRef = useRef<CaptureRegion[]>([])
  const snapCandidateRef = useRef<CaptureRegion | null>(null)

  function readPointer(event: StageEvent): Point | null {
    const stage = event.target.getStage()
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    return { x: pos.x, y: pos.y }
  }

  function handlePress(event: StageEvent) {
    const pt = readPointer(event)
    if (!pt) return

    if (options.phase === 'editing') return

    const clickedOnEmpty = event.target === event.target.getStage()
    if (options.phase === 'annotating' && !clickedOnEmpty) return

    beginRef.current = pt
    isDraggingRef.current = true
    hasMovedRef.current = false

    if (options.phase === 'selecting') {
      snapCandidateRef.current = options.isWindowDetect
        ? findHoverRegion(regionsRef.current, pt.x, pt.y)
        : null
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
        isDraggingRef.current = false
        cancelledRef.current = true
        return
      }
      hasMovedRef.current = true
      options.onUpdateSelection({
        x: Math.min(beginRef.current.x, pt.x),
        y: Math.min(beginRef.current.y, pt.y),
        w: Math.abs(pt.x - beginRef.current.x),
        h: Math.abs(pt.y - beginRef.current.y)
      })
      return
    }

    if (options.phase === 'selecting' && options.isWindowDetect) {
      const hover = findHoverRegion(regionsRef.current, pt.x, pt.y)
      options.onUpdateSelection(hover)
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

    const moved = hasMovedRef.current
    isDraggingRef.current = false
    cancelledRef.current = false
    hasMovedRef.current = false

    const dx = pt.x - beginRef.current.x
    const dy = pt.y - beginRef.current.y
    const tooSmall = Math.abs(dx) < MIN_DRAG_PX && Math.abs(dy) < MIN_DRAG_PX

    if (options.phase === 'selecting') {
      if (tooSmall) {
        const snap = snapCandidateRef.current
        snapCandidateRef.current = null
        if (snap && options.isWindowDetect) {
          options.onUpdateSelection(snap)
          options.onUpdatePhase('editing')
          return
        }
        if (!moved) options.onUpdateSelection(null)
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
      if (!isSinglePoint && tooSmall) {
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

  function resetDragState() {
    isDraggingRef.current = false
    cancelledRef.current = false
    hasMovedRef.current = false
    snapCandidateRef.current = null
  }

  return {
    regionsRef,
    handlePress,
    handleMove,
    handleRelease,
    resetDragState
  }
}

export type { CaptureStageApi, Phase, Selection, UseCaptureStageOptions }
export { useCaptureStage }
