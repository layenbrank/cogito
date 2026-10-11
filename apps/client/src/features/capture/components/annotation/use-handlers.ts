import type Konva from 'konva'
import type { RefObject } from 'react'

import {
  clampPointToClip,
  findAnnotationAtPoint,
  findAnnotationNode,
  findSelectedUnionBounds,
  isMarqueeBlockedTarget,
  isSelectedAnnotationTarget
} from './hit'
import {
  bakeTransformSize,
  boundsContainsPoint
} from '@/features/capture/components/graphics/geometry'
import type { GraphicsProps } from '@/features/capture/components/graphics/types'
import type { SelectionOverlayHandle } from '@/features/capture/components/selection-overlay'
import type { KonvaNodeEvents } from 'react-konva'

interface UseAnnotationHandlersInput {
  stageRef: RefObject<Konva.Stage | null>
  transformerRef: RefObject<Konva.Transformer | null>
  selectionOverlayRef: RefObject<SelectionOverlayHandle | null>
  clipRectRef: RefObject<{ x: number; y: number; w: number; h: number } | null>
  annotations: GraphicsProps[]
  annotationsById: Map<string, GraphicsProps>
  selectedIDs: string[]
  editingID: string | null
  editValue: string
  originalText: string
  interactive: boolean
  phase: 'selecting' | 'annotating' | 'editing'
  graphicsActive?: boolean
  ignoreSelectClickRef: RefObject<boolean>
  beginMarquee: (pt: { x: number; y: number }) => void
  setEditingID: (id: string | null) => void
  setOriginalText: (text: string) => void
  setEditValue: (text: string) => void
  onSelect: (id: string | null, options?: { additive?: boolean }) => void
  onChange: (next: GraphicsProps, options?: { history?: boolean }) => void
  onBatchChange?: (nexts: GraphicsProps[]) => void
  onEditStart: (id: string, text: string) => void
  onContextMenuAnnotation?: (payload: {
    id: string
    clientX: number
    clientY: number
    keepSelection?: boolean
  }) => void
  onClose: () => void
  onPress?: KonvaNodeEvents['onMouseDown']
  onMove?: KonvaNodeEvents['onMouseMove']
  onRelease?: KonvaNodeEvents['onMouseUp']
}

function useAnnotationHandlers(input: UseAnnotationHandlersInput) {
  function handleTransformerEnd() {
    const tr = input.transformerRef.current
    if (!tr) return
    const nodes = tr.nodes()
    const updates: GraphicsProps[] = []
    for (const node of nodes) {
      const id = node.id()
      const propsForNode = input.annotationsById.get(id)
      if (!propsForNode) continue
      const next = bakeTransformSize(node, propsForNode)
      if (next) updates.push(next)
    }
    if (updates.length > 0) {
      if (input.onBatchChange) {
        input.onBatchChange(updates)
      } else {
        for (const item of updates) {
          input.onChange(item, { history: true })
        }
      }
    }
    tr.forceUpdate()
    tr.getLayer()?.batchDraw()
  }

  function handleClose() {
    input.onClose()
  }

  function handleEditStart(id: string, text: string) {
    if (input.editingID && input.editingID !== id) {
      const currentAnnotation = input.annotations.find(function (a) {
        return a.id === input.editingID
      })
      if (currentAnnotation && input.editValue !== input.originalText) {
        input.onChange({ ...currentAnnotation, text: input.editValue })
      }
    }
    input.setEditingID(id)
    input.setOriginalText(text)
    input.setEditValue(text)
    input.onEditStart(id, text)
  }

  function handleEditCommit(value: string) {
    const id = input.editingID
    input.setEditingID(null)
    input.onSelect(null)
    if (!id) return
    if (value === input.originalText) return
    const annotation = input.annotations.find(function (a) {
      return a.id === id
    })
    if (annotation) {
      input.onChange({ ...annotation, text: value })
    }
  }

  function handleEditCancel() {
    input.setEditingID(null)
    input.onSelect(null)
  }

  function handleStageMouseMove(event: Konva.KonvaEventObject<MouseEvent>) {
    const stage = input.stageRef.current ?? event.target.getStage()
    if (stage) {
      const pt = stage.getPointerPosition()
      if (pt) input.selectionOverlayRef.current?.handleStageMouseMove(pt)
    }
    input.onMove?.(event)
  }

  function handleStageMouseUp(event: Konva.KonvaEventObject<MouseEvent>) {
    input.selectionOverlayRef.current?.handleStageMouseUp()
    input.onRelease?.(event)
  }

  function handleMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
    if (event.evt.button !== 0) {
      input.onPress?.(event)
      return
    }

    const blocked = isMarqueeBlockedTarget(event.target)
    const onSelected = isSelectedAnnotationTarget(event.target, input.selectedIDs)
    const canMarquee =
      input.interactive &&
      input.phase !== 'selecting' &&
      !input.graphicsActive &&
      input.annotations.length > 0 &&
      !blocked &&
      (!onSelected || event.evt.shiftKey === true)

    if (canMarquee) {
      const stage = input.stageRef.current ?? event.target.getStage()
      const pt = stage?.getPointerPosition()
      if (pt && stage) {
        if (input.editingID) {
          handleEditCancel()
        }
        input.beginMarquee(clampPointToClip(pt, input.clipRectRef.current))
      }
      input.onPress?.(event)
      return
    }

    if (input.interactive && !input.graphicsActive) {
      const clickedOnEmpty = !findAnnotationNode(event.target)
      if (clickedOnEmpty && !blocked) {
        if (input.editingID) {
          handleEditCancel()
        }
        input.onSelect(null)
      }
    }
    input.onPress?.(event)
  }

  function handleShapeSelect(id: string, options?: { additive?: boolean }) {
    if (input.ignoreSelectClickRef.current) return
    if (input.editingID) {
      handleEditCancel()
    }
    input.onSelect(id, options)
  }

  function handleStageContextMenu(event: Konva.KonvaEventObject<PointerEvent>) {
    event.evt.preventDefault()
    if (!input.interactive) return
    const stage = input.stageRef.current ?? event.target.getStage()
    const pt = stage?.getPointerPosition()

    const node = findAnnotationNode(event.target)
    if (node) {
      const id = node.id()
      if (!id) return
      input.onContextMenuAnnotation?.({
        id,
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
        keepSelection: input.selectedIDs.includes(id)
      })
      return
    }

    if (stage && pt) {
      const probed = findAnnotationAtPoint(stage, input.annotations, pt)
      if (probed) {
        input.onContextMenuAnnotation?.({
          id: probed.id,
          clientX: event.evt.clientX,
          clientY: event.evt.clientY,
          keepSelection: input.selectedIDs.includes(probed.id)
        })
        return
      }
    }

    const primaryID = input.selectedIDs[input.selectedIDs.length - 1]
    if (!primaryID || !stage || !pt) return
    const union = findSelectedUnionBounds(input.annotations, input.selectedIDs, stage)
    if (!union || !boundsContainsPoint(union, pt.x, pt.y)) return
    input.onContextMenuAnnotation?.({
      id: primaryID,
      clientX: event.evt.clientX,
      clientY: event.evt.clientY,
      keepSelection: true
    })
  }

  return {
    handleTransformerEnd,
    handleClose,
    handleEditStart,
    handleEditCommit,
    handleEditCancel,
    handleStageMouseMove,
    handleStageMouseUp,
    handleMouseDown,
    handleShapeSelect,
    handleStageContextMenu
  }
}

export { useAnnotationHandlers }
