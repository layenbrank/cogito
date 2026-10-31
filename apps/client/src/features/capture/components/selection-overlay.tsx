import { forwardRef, useRef, useState } from 'react'
import type Konva from 'konva'

import {
  SelectionDimOnly,
  SelectionOverlayView
} from '@/features/capture/components/selection-overlay-view.tsx'
import type { HandleType } from '@/features/capture/components/selection-clamp'
import { useSelectionOverlayHandlers } from '@/features/capture/components/use-selection-overlay-handlers.ts'

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
  /** 光标位置候选的描述（控件类型 / 窗口标题）；仅选择阶段显示 */
  label?: string
  /**
   * 嵌入共享 CanvasStage 的 interaction 层时为 true：用 Group 代替 Layer，
   * 避免 Konva Layer 嵌套。
   */
  embedded?: boolean
}

const DIM_FILL = 'rgba(0, 0, 0, 0.5)'

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
      hasAnnotations,
      label
    } = props
    const isSelecting = phase === 'selecting'
    const rectInteractive = !isSelecting && !graphicsActive && !hasAnnotations
    const dimFill = dimOpacity !== undefined ? `rgba(0, 0, 0, ${dimOpacity})` : DIM_FILL

    const borderGroupRef = useRef<Konva.Group>(null)
    const [hoveredHandle, setHoveredHandle] = useState<HandleType | null>(null)

    const handlers = useSelectionOverlayHandlers({
      ref,
      selection,
      width,
      height,
      onSelectionChange,
      borderGroupRef
    })

    if (!selection || selection.w <= 0 || selection.h <= 0) {
      if (!isSelecting) return null
      return (
        <SelectionDimOnly
          embedded={embedded}
          width={width}
          height={height}
          dimFill={dimFill}
        />
      )
    }

    const { w, h } = selection
    const sizeText = `${Math.round(w)} \u00d7 ${Math.round(h)}`
    const badgeText = isSelecting && label ? `${label}   ${sizeText}` : sizeText
    const badgeWidth =
      Math.round(sizeText.length * 8) + (badgeText.length > sizeText.length ? label!.length * 12 + 6 : 0) + 12

    const borderCursor = hoveredHandle ? 'default' : 'move'

    return (
      <SelectionOverlayView
        embedded={embedded}
        isSelecting={isSelecting}
        width={width}
        height={height}
        dimFill={dimFill}
        selection={selection}
        rectInteractive={rectInteractive}
        badgeText={badgeText}
        badgeWidth={badgeWidth}
        borderCursor={borderCursor}
        borderGroupRef={borderGroupRef}
        onBorderMouseDown={handlers.onBorderMouseDown}
        onHandleDown={function (type, e) {
          handlers.onHandleDown(type, e, selection)
        }}
        onHoverHandle={setHoveredHandle}
      />
    )
  }
)

export default SelectionOverlay
