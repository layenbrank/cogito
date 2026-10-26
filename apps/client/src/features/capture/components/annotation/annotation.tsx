import { clsx } from 'clsx'
import { forwardRef } from 'react'
import type { KonvaNodeEvents } from 'react-konva'

import type { GraphicsProps } from '@/features/capture/components/graphics/types'

import { AnnotationStage } from './stage'
import { TextEditor } from './text-editor'
import {
  useAnnotationController,
  type AnnotationContextMenuPayload,
  type AnnotationHandle
} from './use-controller'

import styles from './annotation.module.scss'

interface AnnotationProps {
  annotations: GraphicsProps[]
  /** 当前选中的标注 id（null 表示未选中） */
  selectedID: string | null
  /** 多选 id（Ctrl/Meta 叠加；群组点选会展开） */
  selectedIDs: string[]
  /** 是否启用对已有标注的交互（editing 阶段 = true） */
  interactive: boolean
  /** 滤镜底图（mosaic / blur 共用），也会作为 Stage 背景 */
  sourceImage: HTMLImageElement | null
  /** 裁剪选区：不为空时，标注层会裁剪到该区域内 */
  clipRect: { x: number; y: number; w: number; h: number } | null
  onSelect: (id: string | null, options?: { additive?: boolean }) => void
  /** 橡皮筋多选结果（可为空数组表示失焦） */
  onSelectMany?: (ids: string[]) => void
  onChange: (next: GraphicsProps, options?: { history?: boolean }) => void
  /** 多节点 Transform 结束批量回写 */
  onBatchChange?: (nexts: GraphicsProps[]) => void
  onRelease: KonvaNodeEvents['onMouseUp']
  onPress: KonvaNodeEvents['onMouseDown']
  onMove: KonvaNodeEvents['onMouseMove']
  /** 滚轮：选择器换层 / Shift+滚轮换窗口 */
  onWheel?: KonvaNodeEvents['onWheel']
  onEditStart: (id: string, text: string) => void
  /** 右键命中标注，或落在当前选中并集 AABB 内 */
  onContextMenuAnnotation?: (payload: AnnotationContextMenuPayload) => void
  selection: { x: number; y: number; w: number; h: number } | null
  phase: 'selecting' | 'annotating' | 'editing'
  /** 悬停候选的描述（控件类型 / 窗口标题） */
  hoverLabel?: string
  onSelectionChange: (selection: { x: number; y: number; w: number; h: number }) => void
  graphicsActive?: boolean
  onClose: () => void
}

const Annotation = forwardRef<AnnotationHandle, AnnotationProps>(function Annotation(props, ref) {
  const ctrl = useAnnotationController(props, ref)

  return (
    <div className={clsx(styles.annotation)}>
      <AnnotationStage
        stageRef={ctrl.stageRef}
        transformerRef={ctrl.transformerRef}
        selectionOverlayRef={ctrl.selectionOverlayRef}
        marqueeStartRef={ctrl.marqueeStartRef}
        background={ctrl.background}
        stageWidth={ctrl.stageWidth}
        stageHeight={ctrl.stageHeight}
        pixelRatio={ctrl.pixelRatio}
        annotations={props.annotations}
        annotationsById={ctrl.annotationsById}
        selectedIDs={props.selectedIDs}
        selectedIDSet={ctrl.selectedIDSet}
        editingID={ctrl.editingID}
        interactive={props.interactive}
        clipRect={props.clipRect}
        marqueeBox={ctrl.marqueeBox}
        selection={props.selection}
        phase={props.phase}
        hoverLabel={props.hoverLabel}
        graphicsActive={props.graphicsActive}
        withSource={ctrl.withSource}
        onStageMouseMove={ctrl.handleStageMouseMove}
        onMouseDown={ctrl.handleMouseDown}
        onStageMouseUp={ctrl.handleStageMouseUp}
        onStageWheel={props.onWheel}
        onStageContextMenu={ctrl.handleStageContextMenu}
        onSelectionChange={props.onSelectionChange}
        onShapeSelect={ctrl.handleShapeSelect}
        onEditStart={ctrl.handleEditStart}
        onChange={props.onChange}
        onBatchChange={props.onBatchChange}
        onTransformEnd={ctrl.handleTransformerEnd}
      />
      {ctrl.editingID && (
        <TextEditor
          editingID={ctrl.editingID}
          editValue={ctrl.editValue}
          annotation={ctrl.annotationsById.get(ctrl.editingID)}
          stageRef={ctrl.stageRef}
          onChangeValue={ctrl.setEditValue}
          onCommit={ctrl.handleEditCommit}
          onCancel={ctrl.handleEditCancel}
          onClose={ctrl.handleClose}
        />
      )}
    </div>
  )
})

export type { AnnotationContextMenuPayload, AnnotationHandle, AnnotationProps }
export { Annotation }
