import {
  Splitter,
  SplitterHandle,
  SplitterPane,
  type PaneHandle
} from '@cogito/design/components/splitter'
import { Spinner } from '@cogito/design/components/spinner'
import type { RefObject } from 'react'

import type { DirectiveContent } from '@/views/directive/model/types.ts'
import { Canvas } from '@/views/directive/orchestrator/canvas/canvas.tsx'
import { Catalog } from '@/views/directive/orchestrator/catalog.tsx'
import { InspectorAside } from '@/views/directive/orchestrator/inspector/aside.tsx'

/**
 * 编排台分栏（动作库 / 画布 / 右栏）。
 * 右栏用 tabs 收束「检查器 | AI」，避免旁挂对话坞变成第四列。
 * 运行 / 试跑 / 历史 / 终端统一落在壳层底部 Dock。
 */
interface WorkspacePanesProps {
  catalogRef: RefObject<PaneHandle | null>
  inspectorRef: RefObject<PaneHandle | null>
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

function WorkspacePanes(props: WorkspacePanesProps) {
  return (
    <Splitter
      id="directive-editor-panes"
      orientation="horizontal"
      className="h-full min-h-0 w-full flex-1 overflow-hidden">
      <SplitterPane
        id="directive-catalog"
        paneRef={props.catalogRef}
        defaultSize="22%"
        min={200}
        max="34%"
        collapsible
        collapsedSize={0}
        preservePixel
        onResize={function () {
          const nextOpen = !(props.catalogRef.current?.isCollapsed() ?? false)
          if (nextOpen !== props.isCatalogOpen) props.onCatalogOpenChange(nextOpen)
        }}
        className="h-full min-h-0 min-w-0 overflow-hidden">
        <Catalog onInsertAction={props.onInsertAction} />
      </SplitterPane>
      <SplitterHandle withHandle />
      <SplitterPane
        id="directive-canvas"
        defaultSize="48%"
        min={280}
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
      </SplitterPane>
      <SplitterHandle withHandle />
      <SplitterPane
        id="directive-inspector"
        paneRef={props.inspectorRef}
        defaultSize="30%"
        min={260}
        collapsible
        collapsedSize={0}
        preservePixel
        onResize={function () {
          const nextOpen = !(props.inspectorRef.current?.isCollapsed() ?? false)
          if (nextOpen !== props.isInspectorOpen) props.onInspectorOpenChange(nextOpen)
        }}
        className="h-full min-h-0 min-w-0 overflow-hidden">
        {props.draft ? (
          <InspectorAside
            draft={props.draft}
            selectedToken={props.selectedToken}
            onChange={props.onDraftChange}
          />
        ) : null}
      </SplitterPane>
    </Splitter>
  )
}

export { WorkspacePanes }
