import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type PanelImperativeHandle
} from '@i-thinking/design/components/resizable'
import { Spinner } from '@i-thinking/design/components/spinner'
import type { RefObject } from 'react'

import type { DirectiveContent } from '@/views/directive/model/types.ts'
import { Canvas } from '@/views/directive/orchestrator/canvas/canvas.tsx'
import { Catalog } from '@/views/directive/orchestrator/catalog.tsx'
import { Inspector } from '@/views/directive/orchestrator/inspector/inspector.tsx'

/**
 * 编排台分栏（动作库 / 画布 / 检查器）。
 * 运行 / 试跑 / 历史 / 终端统一落在壳层底部 Dock，这里不再叠第二块输出区。
 */
interface WorkspacePanesProps {
  catalogRef: RefObject<PanelImperativeHandle | null>
  inspectorRef: RefObject<PanelImperativeHandle | null>
  isCatalogOpen: boolean
  isInspectorOpen: boolean
  onCatalogOpenChange: (open: boolean) => void
  onInspectorOpenChange: (open: boolean) => void
  isEditorLoading: boolean
  draft: DirectiveContent | null
  selectedToken: string | null
  onSelectToken: (token: string | null) => void
  onDraftChange: (next: DirectiveContent) => void
  onInsertAction: (actionId: string) => void
}

/** 侧面分栏以按钮开合，不允许拖拽吸成 0 宽 */
const PANEL_DRAG = { collapsibleOnDrag: false } as const

/**
 * 库把 `overflow: auto` 写在内层 inline style 上（靠它把内容最小尺寸压成 0，面板才收得干净），
 * class 的 `overflow-hidden` 压不过它 —— 想裁掉折叠途中的内容就得走 style。
 */
const PANEL_CLIP = { overflow: 'hidden' } as const

function WorkspacePanes(props: WorkspacePanesProps) {
  return (
    <ResizablePanelGroup
      id="directive-editor-panes"
      orientation="horizontal"
      className="h-full min-h-0 w-full flex-1 overflow-hidden">
      <ResizablePanel
        id="directive-catalog"
        panelRef={props.catalogRef}
        defaultSize="22%"
        minSize={200}
        maxSize="34%"
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        {...PANEL_DRAG}
        onResize={function () {
          const nextOpen = !(props.catalogRef.current?.isCollapsed() ?? false)
          if (nextOpen !== props.isCatalogOpen) props.onCatalogOpenChange(nextOpen)
        }}
        style={PANEL_CLIP}
        className="h-full min-h-0 min-w-0 overflow-hidden">
        <Catalog onInsertAction={props.onInsertAction} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="directive-canvas"
        defaultSize="48%"
        minSize={280}
        className="h-full min-h-0 min-w-0 overflow-hidden">
        {props.isEditorLoading || !props.draft ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : (
          <Canvas
            draft={props.draft}
            selectedToken={props.selectedToken}
            onSelectToken={props.onSelectToken}
            onChange={props.onDraftChange}
          />
        )}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="directive-inspector"
        panelRef={props.inspectorRef}
        defaultSize="30%"
        minSize={260}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        {...PANEL_DRAG}
        onResize={function () {
          const nextOpen = !(props.inspectorRef.current?.isCollapsed() ?? false)
          if (nextOpen !== props.isInspectorOpen) props.onInspectorOpenChange(nextOpen)
        }}
        style={PANEL_CLIP}
        className="h-full min-h-0 min-w-0 overflow-hidden">
        {props.draft ? (
          <Inspector
            draft={props.draft}
            selectedToken={props.selectedToken}
            onChange={props.onDraftChange}
          />
        ) : null}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export { WorkspacePanes }
