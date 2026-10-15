import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Group, Layer, Rect, Shape, Text } from 'react-konva'
import type Konva from 'konva'

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

interface Point {
  x: number
  y: number
}
interface Size {
  w: number
  h: number
}

export type Phase = 'selecting' | 'annotating' | 'editing'

interface SelectionOverlayProps {
  selection: (Point & Size) | null
  phase: Phase
  width: number
  height: number
  onSelectionChange: (selection: Point & Size) => void
  /** 涟漪动画期间临时降低遮罩暗度（0-1），不传则使用默认值 */
  dimOpacity?: number
  /** 是否有标注工具处于激活状态（annotating 阶段），用于禁用透明拖拽 Rect 的事件拦截 */
  graphicsActive?: boolean
  /** 已有标注时禁裁剪框平移，把空白命中留给失焦 / 橡皮筋多选 */
  hasAnnotations?: boolean
  /**
   * 嵌入共享 CanvasStage 的 interaction 层时为 true：用 Group 代替 Layer，
   * 避免 Konva Layer 嵌套。
   */
  embedded?: boolean
}

const DIM_FILL = 'rgba(0, 0, 0, 0.5)'
const MIN_SEL = 20

type HandleType =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'

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

/** 暴露给 annotation 组件的方法句柄 */
export interface SelectionOverlayHandle {
  /** Stage 级 mouseMove 驱动手柄拖拽（指针离开手柄热区后仍可持续跟踪） */
  handleStageMouseMove(stagePos: { x: number; y: number }): void
  /** Stage 级 mouseUp 结束手柄拖拽 */
  handleStageMouseUp(): void
}

export const SelectionOverlay = forwardRef<SelectionOverlayHandle, SelectionOverlayProps>(
  function SelectionOverlay(props, ref) {
    const {
      selection,
      phase,
      width,
      height,
      embedded = false,
      onSelectionChange,
      dimOpacity,
      graphicsActive,
      hasAnnotations
    } = props
    const isSelecting = phase === 'selecting'
    // 有工具或已有标注时透明 Rect 不拦截；无标注且无工具时可平移裁剪框
    const rectInteractive = !isSelecting && !graphicsActive && !hasAnnotations
    const dimFill = dimOpacity !== undefined ? `rgba(0, 0, 0, ${dimOpacity})` : DIM_FILL

    const dragHandleRef = useRef<HandleType | null>(null)
    const dragStartRef = useRef({ px: 0, py: 0, sx: 0, sy: 0, sw: 0, sh: 0 })
    const [hoveredHandle, setHoveredHandle] = useState<HandleType | null>(null)

    const borderDragRef = useRef<{ startX: number; startY: number } | null>(null)
    const borderGroupRef = useRef<Konva.Group>(null)
    const selectionRef = useRef(selection)

    useEffect(
      function () {
        selectionRef.current = selection
      },
      [selection]
    )

    function clampSelection(type: HandleType, px: number, py: number) {
      const { sx, sy, sw, sh } = dragStartRef.current
      const right = sx + sw
      const bottom = sy + sh
      let nx = sx,
        ny = sy,
        nw = sw,
        nh = sh

      switch (type) {
        case 'nw':
          nx = Math.max(0, Math.min(px, right - MIN_SEL))
          ny = Math.max(0, Math.min(py, bottom - MIN_SEL))
          nw = right - nx
          nh = bottom - ny
          break
        case 'n':
          ny = Math.max(0, Math.min(py, bottom - MIN_SEL))
          nh = bottom - ny
          break
        case 'ne':
          ny = Math.max(0, Math.min(py, bottom - MIN_SEL))
          nw = Math.max(MIN_SEL, Math.min(px - sx, width - sx))
          nh = bottom - ny
          break
        case 'e':
          nw = Math.max(MIN_SEL, Math.min(px - sx, width - sx))
          break
        case 'se':
          nw = Math.max(MIN_SEL, Math.min(px - sx, width - sx))
          nh = Math.max(MIN_SEL, Math.min(py - sy, height - sy))
          break
        case 's':
          nh = Math.max(MIN_SEL, Math.min(py - sy, height - sy))
          break
        case 'sw':
          nx = Math.max(0, Math.min(px, right - MIN_SEL))
          nw = right - nx
          nh = Math.max(MIN_SEL, Math.min(py - sy, height - sy))
          break
        case 'w':
          nx = Math.max(0, Math.min(px, right - MIN_SEL))
          nw = right - nx
          break
      }

      onSelectionChange({ x: nx, y: ny, w: nw, h: nh })
    }

    useImperativeHandle(
      ref,
      function () {
        return {
          handleStageMouseMove(stagePos: { x: number; y: number }) {
            const type = dragHandleRef.current
            if (type) {
              clampSelection(type, stagePos.x, stagePos.y)
              return
            }
            const drag = borderDragRef.current
            const sel = selectionRef.current
            if (drag && borderGroupRef.current && sel) {
              const group = borderGroupRef.current
              const curX = group.x()
              const curY = group.y()
              const dx = stagePos.x - drag.startX
              const dy = stagePos.y - drag.startY
              const newX = Math.max(0, Math.min(curX + dx, width - sel.w))
              const newY = Math.max(0, Math.min(curY + dy, height - sel.h))
              group.position({ x: newX, y: newY })
              drag.startX = stagePos.x
              drag.startY = stagePos.y
            }
          },
          handleStageMouseUp() {
            dragHandleRef.current = null
            const drag = borderDragRef.current
            const sel = selectionRef.current
            if (drag && borderGroupRef.current && sel) {
              const finalX = borderGroupRef.current.x()
              const finalY = borderGroupRef.current.y()
              onSelectionChange({ x: finalX, y: finalY, w: sel.w, h: sel.h })
            }
            borderDragRef.current = null
          }
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [width, height, onSelectionChange]
    )

    const Shell = embedded ? Group : Layer

    if (!selection || selection.w <= 0 || selection.h <= 0) {
      if (!isSelecting) return null
      return (
        <Shell listening={false} name="selection-overlay-layer">
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill={dimFill}
            listening={false}
          />
        </Shell>
      )
    }

    const { x, y, w, h } = selection

    function onHandleDown(type: HandleType, e: Konva.KonvaEventObject<MouseEvent>) {
      e.cancelBubble = true
      const stage = e.target.getStage()
      const pt = stage?.getPointerPosition()
      if (!pt) return
      dragHandleRef.current = type
      dragStartRef.current = { px: pt.x, py: pt.y, sx: x, sy: y, sw: w, sh: h }
    }

    const borderCursor = hoveredHandle ? 'default' : 'move'
    const hit = ANCHOR_SIZE

    return (
      <Shell listening={!isSelecting} name="selection-overlay-layer">
        {/* 直角挖洞，避免误以为裁剪输出带圆角 */}
        <Shape
          listening={false}
          perfectDrawEnabled={false}
          fill={dimFill}
          fillRule="evenodd"
          sceneFunc={function (context, shape) {
            context.beginPath()
            context.rect(0, 0, width, height)
            context.rect(x, y, w, h)
            context.fillStrokeShape(shape)
          }}
        />

        <Group ref={borderGroupRef} x={x} y={y}>
          <Rect
            width={w}
            height={h}
            fill="transparent"
            stroke="transparent"
            strokeWidth={10}
            listening={rectInteractive}
            draggable={false}
            cursor={rectInteractive ? borderCursor : 'default'}
            onMouseDown={function (e) {
              if (!rectInteractive) return
              e.cancelBubble = true
              const stage = e.target.getStage()
              const pt = stage?.getPointerPosition()
              if (!pt) return
              borderDragRef.current = {
                startX: pt.x,
                startY: pt.y
              }
            }}
          />
          {/* 直角细白描边 */}
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
              width={String(`${Math.round(w)} \u00d7 ${Math.round(h)}`).length * 8 + 12}
              height={20}
              fill="rgba(0, 0, 0, 0.72)"
              cornerRadius={3}
            />
            <Text
              x={6}
              y={3}
              text={`${Math.round(w)} \u00d7 ${Math.round(h)}`}
              fontSize={12}
              fontFamily="ui-monospace, monospace"
              fill="#ffffff"
            />
          </Group>

          {/* 四角：直角玻璃 L（贴合角点，无圆角） */}
          {!isSelecting &&
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
                      onHandleDown(corner, e)
                    }}
                    onMouseEnter={function () {
                      setHoveredHandle(corner)
                    }}
                    onMouseLeave={function () {
                      setHoveredHandle(null)
                    }}
                  />
                </Group>
              )
            })}

          {/* 四边中点：直角短玻璃条 */}
          {!isSelecting &&
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
                    onHandleDown(type, e)
                  }}
                  onMouseEnter={function () {
                    setHoveredHandle(type)
                  }}
                  onMouseLeave={function () {
                    setHoveredHandle(null)
                  }}
                />
              )
            })}
        </Group>
      </Shell>
    )
  }
)

export default SelectionOverlay
