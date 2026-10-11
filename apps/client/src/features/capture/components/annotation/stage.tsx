import type Konva from 'konva'
import type { MutableRefObject, RefObject } from 'react'
import { Layer, Image as ReImage, Rect, Stage, Transformer, type KonvaNodeEvents } from 'react-konva'

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

interface AnnotationStageProps {
  stageRef: RefObject<Konva.Stage | null>
  transformerRef: RefObject<Konva.Transformer | null>
  selectionOverlayRef: RefObject<SelectionOverlayHandle | null>
  marqueeStartRef: MutableRefObject<{ x: number; y: number } | null>
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
    pixelRatio,
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

  return (
    <Stage
      ref={stageRef}
      onMouseMove={onStageMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onStageMouseUp}
      onContextMenu={onStageContextMenu}
      width={stageWidth}
      height={stageHeight}
      pixelRatio={pixelRatio}>
      <Layer
        listening={false}
        imageSmoothingEnabled={false}>
        {background && (
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
        )}
      </Layer>
      <SelectionOverlay
        ref={selectionOverlayRef}
        selection={selection}
        phase={phase}
        width={stageWidth}
        height={stageHeight}
        onSelectionChange={onSelectionChange}
        graphicsActive={graphicsActive}
        hasAnnotations={annotations.length > 0}
      />
      <Layer listening={false}>
        <SpotlightMask
          annotations={annotations}
          width={stageWidth}
          height={stageHeight}
        />
      </Layer>
      <Layer
        listening={annotations.length > 0}
        clipFunc={
          clipRect && clipRect.w > 0 && clipRect.h > 0
            ? function (ctx) {
                ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h)
              }
            : undefined
        }>
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
      </Layer>
      {marqueeBox && marqueeBox.w + marqueeBox.h > 0 && (
        <Layer listening={false}>
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
          />
        </Layer>
      )}
    </Stage>
  )
}

export type { AnnotationStageProps }
export { AnnotationStage }
