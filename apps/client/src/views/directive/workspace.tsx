import { useMemo } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router-dom'

import { useCorexStore } from '@/stores/corex.ts'
import { Toolbar } from '@/views/directive/orchestrator/toolbar.tsx'
import { capsFromTriggers } from '@/views/directive/run/run-caps.ts'
import { useWorkspaceDirective } from '@/views/directive/use-workspace-directive.ts'
import { useWorkspacePanels } from '@/views/directive/use-workspace-panels.ts'
import { WorkspaceLeaveDialog } from '@/views/directive/workspace-leave-dialog.tsx'
import { WorkspacePanes } from '@/views/directive/workspace-panes.tsx'

function DirectiveWorkspace() {
  const params = useParams()
  const name = decodeURIComponent(params.name ?? '')
  const navigate = useNavigate()
  const panels = useWorkspacePanels()

  const directives = useCorexStore(function (state) {
    return state.directives
  })
  const selectedToken = useCorexStore(function (state) {
    return state.selectedToken
  })
  const isEditorLoading = useCorexStore(function (state) {
    return state.isEditorLoading
  })
  const isSaving = useCorexStore(function (state) {
    return state.isSaving
  })
  const undoStack = useCorexStore(function (state) {
    return state.undoStack
  })
  const redoStack = useCorexStore(function (state) {
    return state.redoStack
  })
  const isDraftDirty = useCorexStore(function (state) {
    return state.isDraftDirty
  })

  const isPending = useMemo(
    function () {
      return !directives.some(function (entry) {
        return entry.name === name
      })
    },
    [directives, name]
  )

  const isDirty = isDraftDirty()

  const entry = useMemo(
    function () {
      return directives.find(function (item) {
        return item.name === name
      })
    },
    [directives, name]
  )

  const workspace = useWorkspaceDirective({
    name,
    isPending,
    isDirty,
    onOpenRunPanel() {
      panels.setRunOpen(true)
    }
  })

  const caps = useMemo(
    function () {
      return capsFromTriggers(workspace.draft?.triggers)
    },
    [workspace.draft?.triggers]
  )

  const stepCount = Array.isArray(workspace.draft?.steps)
    ? workspace.draft.steps.length
    : (entry?.summary?.step_count ?? 0)
  const inputCount = Array.isArray(workspace.draft?.inputs)
    ? workspace.draft.inputs.length
    : (entry?.summary?.input_count ?? 0)

  const blocker = useBlocker(isDirty)

  if (!name) {
    return <p className="p-6 text-sm text-muted-foreground">未指定指令名称。</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Toolbar
        name={workspace.draft?.name ?? name}
        description={workspace.draft?.description ?? entry?.summary?.description}
        bucket={workspace.draft?.bucket ?? entry?.bucket}
        folder={entry?.folder}
        stepCount={stepCount}
        inputCount={inputCount}
        caps={caps}
        isDirty={isDirty}
        isSaving={isSaving}
        isPending={isPending}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        isCatalogOpen={panels.isCatalogOpen}
        isInspectorOpen={panels.isInspectorOpen}
        isRunOpen={panels.isRunOpen}
        onToggleCatalog={function () {
          panels.withPanelAnimation(function () {
            panels.setCatalogOpen(!panels.isCatalogOpen)
          })
        }}
        onToggleInspector={function () {
          panels.withPanelAnimation(function () {
            panels.setInspectorOpen(!panels.isInspectorOpen)
          })
        }}
        onToggleRun={function () {
          panels.withPanelAnimation(function () {
            panels.setRunOpen(!panels.isRunOpen)
          })
        }}
        onBack={function () {
          void navigate('/directive')
        }}
        onSave={workspace.handleSave}
        onUndo={workspace.undoDraft}
        onRedo={workspace.redoDraft}
        onValidate={function () {
          void workspace.handleValidate()
        }}
        onOnce={workspace.handleOnce}
        beforeGuard={workspace.beforeGuard}
        onDelete={workspace.handleDelete}
        onDeleted={function () {
          void navigate('/directive')
        }}
      />

      <WorkspacePanes
        isPanelAnimating={panels.isPanelAnimating}
        catalogRef={panels.catalogRef}
        inspectorRef={panels.inspectorRef}
        runRef={panels.runRef}
        isCatalogOpen={panels.isCatalogOpen}
        isInspectorOpen={panels.isInspectorOpen}
        isRunOpen={panels.isRunOpen}
        onCatalogOpenChange={panels.setCatalogOpen}
        onInspectorOpenChange={panels.setInspectorOpen}
        onRunOpenChange={panels.setRunOpen}
        isEditorLoading={isEditorLoading}
        draft={workspace.draft}
        selectedToken={selectedToken}
        directiveName={workspace.draft?.name ?? name}
        onSelectToken={workspace.setSelectedToken}
        onDraftChange={workspace.replaceDraft}
        onInsertAction={workspace.insertAction}
      />

      <WorkspaceLeaveDialog
        open={blocker.state === 'blocked'}
        onStay={function () {
          blocker.reset?.()
        }}
        onLeave={function () {
          blocker.proceed?.()
        }}
      />
    </div>
  )
}

export default DirectiveWorkspace
