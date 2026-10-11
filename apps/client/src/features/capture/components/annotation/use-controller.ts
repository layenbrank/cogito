import type Konva from 'konva'
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref
} from 'react'
import type { KonvaNodeEvents } from 'react-konva'

import type { GraphicsProps } from '@/features/capture/components/graphics/types'
import type { SelectionOverlayHandle } from '@/features/capture/components/selection-overlay'
import { findKonvaByID } from '@/features/capture/components/graphics/geometry'

import { useAnnotationHandlers } from './use-handlers'
import { useAnnotationMarquee } from './use-marquee'

interface AnnotationContextMenuPayload {
  id: string
  clientX: number
  clientY: number
  keepSelection?: boolean
}

interface AnnotationControllerProps {
  annotations: GraphicsProps[]
  selectedIDs: string[]
  interactive: boolean
  sourceImage: HTMLImageElement | null
  clipRect: { x: number; y: number; w: number; h: number } | null
  onSelect: (id: string | null, options?: { additive?: boolean }) => void
  onSelectMany?: (ids: string[]) => void
  onChange: (next: GraphicsProps, options?: { history?: boolean }) => void
  onBatchChange?: (nexts: GraphicsProps[]) => void
  onRelease: KonvaNodeEvents['onMouseUp']
  onPress: KonvaNodeEvents['onMouseDown']
  onMove: KonvaNodeEvents['onMouseMove']
  onEditStart: (id: string, text: string) => void
  onContextMenuAnnotation?: (payload: AnnotationContextMenuPayload) => void
  phase: 'selecting' | 'annotating' | 'editing'
  graphicsActive?: boolean
  onClose: () => void
}

interface AnnotationHandle {
  renderPng(): string | null
  getStage(): Konva.Stage | null
  startEditing(id: string, initialText?: string): void
}

function useAnnotationController(
  props: AnnotationControllerProps,
  ref: Ref<AnnotationHandle>
) {
  const {
    annotations,
    clipRect,
    interactive,
    selectedIDs,
    sourceImage,
    onChange,
    onSelect,
    onSelectMany,
    onPress,
    onMove,
    onRelease,
    onEditStart,
    onContextMenuAnnotation,
    onClose,
    onBatchChange,
    phase,
    graphicsActive
  } = props

  const background = sourceImage
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const selectionOverlayRef = useRef<SelectionOverlayHandle>(null)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [originalText, setOriginalText] = useState('')
  const [editValue, setEditValue] = useState('')
  const annotationsRef = useRef(annotations)
  const clipRectRef = useRef(clipRect)
  const onSelectRef = useRef(onSelect)
  const onSelectManyRef = useRef(onSelectMany)

  const annotationsById = useMemo(
    function () {
      return new Map(
        annotations.map(function (annotation) {
          return [annotation.id, annotation] as const
        })
      )
    },
    [annotations]
  )
  const selectedIDSet = useMemo(
    function () {
      return new Set(selectedIDs)
    },
    [selectedIDs]
  )

  useEffect(
    function () {
      annotationsRef.current = annotations
      clipRectRef.current = clipRect
      onSelectRef.current = onSelect
      onSelectManyRef.current = onSelectMany
    },
    [annotations, clipRect, onSelect, onSelectMany]
  )

  const { marqueeStartRef, marqueeBox, ignoreSelectClickRef, beginMarquee } = useAnnotationMarquee({
    stageRef,
    annotationsRef,
    clipRectRef,
    onSelectRef,
    onSelectManyRef
  })

  const [viewport, setViewport] = useState<{ width: number; height: number }>(function () {
    return { width: window.innerWidth, height: window.innerHeight }
  })
  useEffect(function () {
    function onResize() {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return function () {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const stageWidth =
    background && background.naturalWidth > 0 ? background.naturalWidth / dpr : viewport.width
  const stageHeight =
    background && background.naturalHeight > 0 ? background.naturalHeight / dpr : viewport.height
  const pixelRatio = dpr

  useImperativeHandle(
    ref,
    function () {
      return {
        renderPng() {
          const stage = stageRef.current
          if (!stage) return null
          const tr = transformerRef.current
          if (tr) tr.visible(false)
          const maskLayers = stage.find(function (node: Konva.Node) {
            return node.name() === 'selection-overlay-layer'
          })
          maskLayers.forEach(function (layer) {
            layer.visible(false)
          })
          const opts: {
            pixelRatio: number
            x?: number
            y?: number
            width?: number
            height?: number
          } = {
            pixelRatio
          }
          if (clipRect && clipRect.w > 0 && clipRect.h > 0) {
            opts.x = clipRect.x
            opts.y = clipRect.y
            opts.width = clipRect.w
            opts.height = clipRect.h
          }
          const url = stage.toDataURL(opts)
          maskLayers.forEach(function (layer) {
            layer.visible(true)
          })
          if (tr) tr.visible(true)
          return url
        },
        getStage() {
          return stageRef.current
        },
        startEditing(id: string, initialText?: string) {
          const text = initialText ?? annotationsById.get(id)?.text ?? ''
          setEditingID(id)
          setOriginalText(text)
          setEditValue(text)
        }
      }
    },
    [clipRect, annotationsById, pixelRatio]
  )

  useEffect(
    function () {
      const tr = transformerRef.current
      const stage = stageRef.current
      if (!tr || !stage) return
      if (editingID) {
        tr.nodes([])
        tr.getLayer()?.batchDraw()
        return
      }
      if (selectedIDs.length === 0) {
        tr.nodes([])
        tr.getLayer()?.batchDraw()
        return
      }
      const nodes: Konva.Node[] = []
      for (const id of selectedIDs) {
        const annotation = annotationsById.get(id)
        if (annotation?.locked) continue
        const node = findKonvaByID(stage, id)
        if (node) nodes.push(node)
      }
      tr.nodes(nodes)
      tr.getLayer()?.batchDraw()
    },
    [selectedIDs, annotationsById, editingID]
  )

  const handlers = useAnnotationHandlers({
    stageRef,
    transformerRef,
    selectionOverlayRef,
    clipRectRef,
    annotations,
    annotationsById,
    selectedIDs,
    editingID,
    editValue,
    originalText,
    interactive,
    phase,
    graphicsActive,
    ignoreSelectClickRef,
    beginMarquee,
    setEditingID,
    setOriginalText,
    setEditValue,
    onSelect,
    onChange,
    onBatchChange,
    onEditStart,
    onContextMenuAnnotation,
    onClose,
    onPress,
    onMove,
    onRelease
  })

  function withSource(annotation: GraphicsProps): GraphicsProps {
    if (!sourceImage) return annotation
    if (annotation.type !== 'mosaic' && annotation.type !== 'blur') return annotation
    return { ...annotation, sourceImage }
  }

  return {
    stageRef,
    transformerRef,
    selectionOverlayRef,
    marqueeStartRef,
    background,
    stageWidth,
    stageHeight,
    pixelRatio,
    annotationsById,
    selectedIDSet,
    editingID,
    editValue,
    setEditValue,
    marqueeBox,
    withSource,
    ...handlers
  }
}

export { useAnnotationController }
export type { AnnotationContextMenuPayload, AnnotationHandle, AnnotationControllerProps }
