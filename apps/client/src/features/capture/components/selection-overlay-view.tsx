import { Group, Layer, Rect, Shape, Text } from 'react-konva'
import type Konva from 'konva'
import type { RefObject } from 'react'

import {
  ANCHOR_SIZE,
  BORDER_STROKE,
  BORDER_WIDTH,
  CORNER_ARM,
  CORNER_STROKE,
  GLASS_BODY,
  GLASS_EDGE,
  findCornerOrigin,
  findEdgeHandleBox,
  paintSharpGlassL,
  type CornerKind
} from '@/features/capture/components/corner-handle'
import type { HandleType } from '@/features/capture/components/selection-clamp'

const CORNER_HANDLES: CornerKind[] = ['nw', 'ne', 'se', 'sw']
const EDGE_HANDLES: Array<'n' | 'e' | 's' | 'w'> = ['n', 'e', 's', 'w']

const HANDLE_CURSORS: Record<HandleType, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize'
}

interface SelectionOverlayViewProps {
  embedded: boolean
  isSelecting: boolean
  width: number
  height: number
  dimFill: string
  selection: { x: number; y: number; w: number; h: number }
  rectInteractive: boolean
  badgeText: string
  badgeWidth: number
  borderCursor: string
  borderGroupRef: RefObject<Konva.Group | null>
  onBorderMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => void
  onHandleDown: (type: HandleType, e: Konva.KonvaEventObject<MouseEvent>) => void
  onHoverHandle: (type: HandleType | null) => void
}

function SelectionDimOnly(props: {
  embedded: boolean
  width: number
  height: number
  dimFill: string
}) {
  const Shell = props.embedded ? Group : Layer
  return (
    <Shell listening={false} name="selection-overlay-layer">
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={props.height}
        fill={props.dimFill}
        listening={false}
      />
    </Shell>
  )
}

function SelectionOverlayView(props: SelectionOverlayViewProps) {
  const Shell = props.embedded ? Group : Layer
  const { x, y, w, h } = props.selection
  const hit = ANCHOR_SIZE

  return (
    <Shell listening={!props.isSelecting} name="selection-overlay-layer">
      <Shape
        listening={false}
        perfectDrawEnabled={false}
        fill={props.dimFill}
        fillRule="evenodd"
        sceneFunc={function (context, shape) {
          context.beginPath()
          context.rect(0, 0, props.width, props.height)
          context.rect(x, y, w, h)
          context.fillStrokeShape(shape)
        }}
      />

      <Group ref={props.borderGroupRef} x={x} y={y}>
        <Rect
          width={w}
          height={h}
          fill="transparent"
          stroke="transparent"
          strokeWidth={10}
          listening={props.rectInteractive}
          draggable={false}
          cursor={props.rectInteractive ? props.borderCursor : 'default'}
          onMouseDown={props.onBorderMouseDown}
        />
        <Rect
          width={w}
          height={h}
          stroke={BORDER_STROKE}
          strokeWidth={BORDER_WIDTH}
          shadowColor="rgba(0, 0, 0, 0.35)"
          shadowBlur={8}
          shadowOpacity={0.55}
          listening={false}
        />

        <Group y={y >= 24 ? -22 : 4} listening={false}>
          <Rect
            width={props.badgeWidth}
            height={20}
            fill="rgba(0, 0, 0, 0.72)"
            cornerRadius={3}
          />
          <Text
            x={6}
            y={3}
            text={props.badgeText}
            fontSize={12}
            fontFamily="ui-monospace, monospace"
            fill="#ffffff"
          />
        </Group>

        {!props.isSelecting &&
          CORNER_HANDLES.map(function (corner) {
            const origin = findCornerOrigin(corner, w, h)
            return (
              <Group key={corner} x={origin.x} y={origin.y}>
                <Shape
                  listening={false}
                  perfectDrawEnabled={false}
                  sceneFunc={function (ctx) {
                    paintSharpGlassL(ctx, corner, CORNER_ARM, CORNER_STROKE)
                  }}
                />
                <Rect
                  x={-hit / 2}
                  y={-hit / 2}
                  width={hit}
                  height={hit}
                  fill="transparent"
                  cursor={HANDLE_CURSORS[corner]}
                  onMouseDown={function (e) {
                    props.onHandleDown(corner, e)
                  }}
                  onMouseEnter={function () {
                    props.onHoverHandle(corner)
                  }}
                  onMouseLeave={function () {
                    props.onHoverHandle(null)
                  }}
                />
              </Group>
            )
          })}

        {!props.isSelecting &&
          EDGE_HANDLES.map(function (type) {
            const box = findEdgeHandleBox(type, w, h)
            return (
              <Rect
                key={type}
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                cornerRadius={0}
                fill={GLASS_BODY}
                stroke={GLASS_EDGE}
                strokeWidth={0.75}
                shadowColor="rgba(0, 0, 0, 0.28)"
                shadowBlur={3}
                shadowOffsetY={1}
                cursor={HANDLE_CURSORS[type]}
                onMouseDown={function (e) {
                  props.onHandleDown(type, e)
                }}
                onMouseEnter={function () {
                  props.onHoverHandle(type)
                }}
                onMouseLeave={function () {
                  props.onHoverHandle(null)
                }}
              />
            )
          })}
      </Group>
    </Shell>
  )
}

export { SelectionDimOnly, SelectionOverlayView }
