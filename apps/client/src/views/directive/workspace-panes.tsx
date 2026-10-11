import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type PanelImperativeHandle
} from '@i-thinking/design/components/resizable'
import { Spinner } from '@i-thinking/design/components/spinner'
import { cn } from 'cn'
import type { RefObject } from 'react'

import type { DirectiveContent } from '@/views/directive/model/types.ts'
import { OrchestratorCanvas } from '@/views/directive/orchestrator/canvas/canvas.tsx'
import { OrchestratorCatalog } from '@/views/directive/orchestrator/catalog.tsx'
import { OrchestratorInspector } from '@/views/directive/orchestrator/inspector/inspector.tsx'
import { RunPanel } from '@/views/directive/run/run-panel.tsx'

import styles from '@/views/directive/workspace.module.scss'

interface WorkspacePanesProps {
  isPanelAnimating: boolean
  catalogRef: RefObject<PanelImperativeHandle | null>
  inspectorRef: RefObject<PanelImperativeHandle | null>
  runRef: RefObject<PanelImperativeHandle | null>
  isCatalogOpen: boolean
  isInspectorOpen: boolean
  isRunOpen: boolean
  onCatalogOpenChange: (open: boolean) => void
  onInspectorOpenChange: (open: boolean) => void
  onRunOpenChange: (open: boolean) => void
  isEditorLoading: boolean
  draft: DirectiveContent | null
  selectedToken: string | null
  directiveName: string
  onSelectToken: (token: string | null) => void
  onDraftChange: (next: DirectiveContent) => void
  onInsertAction: (actionId: string) => void
}

function WorkspacePanes(props: WorkspacePanesProps) {
  return (
    <ResizablePanelGroup
      orientation="vertical"
      className={cn('min-h-0 flex-1', props.isPanelAnimating && styles.panesAnimating)}>
      <ResizablePanel
        id="directive-editor"
        defaultSize="68%"
        minSize={240}
        className="min-h-0 overflow-hidden">
        <ResizablePanelGroup
          id="directive-editor-panes"
          orientation="horizontal"
          className={cn('min-h-0 h-full', props.isPanelAnimating && styles.panesAnimating)}>
          <ResizablePanel
            id="directive-catalog"
            panelRef={props.catalogRef}
            defaultSize="22%"
            minSize={200}
            maxSize="34%"
            collapsible
            collapsedSize={0}
            groupResizeBehavior="preserve-pixel-size"
            onResize={function () {
              const nextOpen = !(props.catalogRef.current?.isCollapsed() ?? false)
              if (nextOpen !== props.isCatalogOpen) props.onCatalogOpenChange(nextOpen)
            }}
            className="min-h-0 min-w-0 overflow-hidden">
            <div
              className={cn(
                styles.panelBody,
                !props.isCatalogOpen && styles.panelBodyCollapsed
              )}>
              <OrchestratorCatalog onInsertAction={props.onInsertAction} />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="directive-canvas"
            defaultSize="48%"
            minSize={280}
            className="min-h-0 min-w-0 overflow-hidden">
            {props.isEditorLoading || !props.draft ? (
              <div className="flex h-full items-center justify-center">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : (
              <OrchestratorCanvas
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
            onResize={function () {
              const nextOpen = !(props.inspectorRef.current?.isCollapsed() ?? false)
              if (nextOpen !== props.isInspectorOpen) props.onInspectorOpenChange(nextOpen)
            }}
            className="min-h-0 min-w-0 overflow-hidden">
            <div
              className={cn(
                styles.panelBody,
                !props.isInspectorOpen && styles.panelBodyCollapsed
              )}>
              {props.draft ? (
                <OrchestratorInspector
                  draft={props.draft}
                  selectedToken={props.selectedToken}
                  onChange={props.onDraftChange}
                />
              ) : null}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="directive-run"
        panelRef={props.runRef}
        defaultSize="32%"
        minSize={160}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        onResize={function () {
          const nextOpen = !(props.runRef.current?.isCollapsed() ?? false)
          if (nextOpen !== props.isRunOpen) props.onRunOpenChange(nextOpen)
        }}
        className="min-h-0 overflow-hidden">
        <div className={cn(styles.panelBody, !props.isRunOpen && styles.panelBodyCollapsed)}>
          <RunPanel directiveName={props.directiveName} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export { WorkspacePanes }
