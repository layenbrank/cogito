import type Konva from 'konva'
import type { RefObject } from 'react'
import { useMemo } from 'react'
import { Group, Image as ReImage, Rect, Transformer, type KonvaNodeEvents } from 'react-konva'

import {
  ANCHOR_SIZE,
  BORDER_STROKE,
  BORDER_WIDTH,
  ROTATE_OFFSET,
  cornerAnchor
} from '@/features/capture/components/corner-handle'
import Graphics, { SpotlightMask } from '@/features/capture/components/graphics'
import { findDragPeerIDs } from '@/features/capture/components/graphics/drag-peers'
import type { Bounds } from '@/features/capture/components/graphics/geometry'
import type { GraphicsProps } from '@/features/capture/components/graphics/types'
import { SelectionOverlay, type SelectionOverlayHandle } from '@/features/capture/components/selection-overlay'
import { CanvasStage } from '@/lib/canvas'

interface AnnotationStageProps {
  stageRef: RefObject<Konva.Stage | null>
  transformerRef: RefObject<Konva.Transformer | null>
  selectionOverlayRef: RefObject<SelectionOverlayHandle | null>
  marqueeStartRef: RefObject<{ x: number; y: number } | null>
  background: HTMLImageElement | null
  stageWidth: number
  stageHeight: number
  pixelRatio: number
  annotations: GraphicsProps[]
  annotationsById: Map<string, GraphicsProps>
  selectedIDs: string[]
  selectedIDSet: Set<string>
  editingID: string | null
  interactive: boolean
  clipRect: { x: number; y: number; w: number; h: number } | null
  marqueeBox: Bounds | null
  selection: { x: number; y: number; w: number; h: number } | null
  phase: 'selecting' | 'annotating' | 'editing'
  graphicsActive?: boolean
  withSource: (annotation: GraphicsProps) => GraphicsProps
  onStageMouseMove: KonvaNodeEvents['onMouseMove']
  onMouseDown: KonvaNodeEvents['onMouseDown']
  onStageMouseUp: KonvaNodeEvents['onMouseUp']
  onStageContextMenu: (event: Konva.KonvaEventObject<PointerEvent>) => void
  onSelectionChange: (selection: { x: number; y: number; w: number; h: number }) => void
  onShapeSelect: (id: string, options?: { additive?: boolean }) => void
  onEditStart: (id: string, text: string) => void
  onChange: (next: GraphicsProps, options?: { history?: boolean }) => void
  onBatchChange?: (nexts: GraphicsProps[]) => void
  onTransformEnd: () => void
}

function AnnotationStage(props: AnnotationStageProps) {
  const {
    stageRef,
    transformerRef,
    selectionOverlayRef,
    marqueeStartRef,
    background,
    stageWidth,
    stageHeight,
    annotations,
    annotationsById,
    selectedIDs,
    selectedIDSet,
    editingID,
    interactive,
    clipRect,
    marqueeBox,
    selection,
    phase,
    graphicsActive,
    withSource,
    onStageMouseMove,
    onMouseDown,
    onStageMouseUp,
    onStageContextMenu,
    onSelectionChange,
    onShapeSelect,
    onEditStart,
    onChange,
    onBatchChange,
    onTransformEnd
  } = props

  const viewSize = useMemo(
    function () {
      return { width: stageWidth, height: stageHeight }
    },
    [stageWidth, stageHeight]
  )

  const clipX = clipRect?.x ?? 0
  const clipY = clipRect?.y ?? 0
  const clipW = clipRect?.w ?? 0
  const clipH = clipRect?.h ?? 0
  const hasClip = Boolean(clipRect && clipW > 0 && clipH > 0)
  const clipFunc = useMemo(
    function () {
      if (!hasClip) return undefined
      return function (ctx: Konva.Context) {
        ctx.rect(clipX, clipY, clipW, clipH)
      }
    },
    [hasClip, clipX, clipY, clipW, clipH]
  )

  return (
    <CanvasStage
      konvaStageRef={stageRef}
      contentSize={viewSize}
      viewSize={viewSize}
      fitContent={false}
      mediaListening={false}
      contentListening={annotations.length > 0}
      onStageMouseDown={onMouseDown}
      onStageMouseMove={onStageMouseMove}
      onStageMouseUp={onStageMouseUp}
      onStageContextMenu={onStageContextMenu}
      background={
        <Rect
          x={0}
          y={0}
          width={stageWidth}
          height={stageHeight}
          fill="#0a0a0a"
          listening={false}
        />
      }
      media={
        background ? (
          <ReImage
            image={background}
            x={0}
            y={0}
            width={stageWidth}
            height={stageHeight}
            listening={false}
            perfectDrawEnabled={false}
            imageSmoothingEnabled={false}
          />
        ) : null
      }
      content={
        <>
          <SpotlightMask
            annotations={annotations}
            width={stageWidth}
            height={stageHeight}
          />
          <Group
            listening={annotations.length > 0}
            clipFunc={clipFunc}>
            {annotations.map(function (annotation) {
              const peerIDs = findDragPeerIDs(annotation, annotations, selectedIDs)
              const isGrouped = Boolean(annotation.groupID)
              return (
                <Graphics
                  key={annotation.id}
                  {...withSource(annotation)}
                  interactive={interactive}
                  isSelected={selectedIDSet.has(annotation.id)}
                  hideSelectFrame={selectedIDs.length > 1 || isGrouped}
                  dragPeerIDs={peerIDs}
                  findGraphics={function (id) {
                    return annotationsById.get(id)
                  }}
                  isEditing={annotation.id === editingID}
                  onSelect={onShapeSelect}
                  onEditStart={onEditStart}
                  onChange={onChange}
                  onBatchChange={onBatchChange}
                  marqueeStartRef={marqueeStartRef}
                />
              )
            })}
          </Group>
        </>
      }
      interaction={
        <>
          <SelectionOverlay
            ref={selectionOverlayRef}
            embedded
            selection={selection}
            phase={phase}
            width={stageWidth}
            height={stageHeight}
            onSelectionChange={onSelectionChange}
            graphicsActive={graphicsActive}
            hasAnnotations={annotations.length > 0}
          />
          <Transformer
            ref={transformerRef}
            anchorSize={ANCHOR_SIZE}
            anchorCornerRadius={0}
            anchorStyleFunc={cornerAnchor}
            borderStroke={BORDER_STROKE}
            borderStrokeWidth={BORDER_WIDTH}
            rotateEnabled={true}
            rotateAnchorOffset={ROTATE_OFFSET}
            rotationSnaps={[0, 90, 180, 270]}
            rotationSnapTolerance={15}
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            ignoreStroke={true}
            keepRatio={false}
            flipEnabled={false}
            padding={0}
            boundBoxFunc={function (oldBox, newBox) {
              if (newBox.width < 5 || newBox.height < 5) {
                return oldBox
              }
              return newBox
            }}
            onTransformEnd={onTransformEnd}
          />
          {marqueeBox && marqueeBox.w + marqueeBox.h > 0 && (
            <Rect
              x={marqueeBox.x}
              y={marqueeBox.y}
              width={marqueeBox.w}
              height={marqueeBox.h}
              fill="rgba(64, 128, 255, 0.15)"
              stroke="#4080ff"
              strokeWidth={1}
              dash={[4, 4]}
              perfectDrawEnabled={false}
              listening={false}
            />
          )}
        </>
      }
    />
  )
}

export type { AnnotationStageProps }
export { AnnotationStage }
