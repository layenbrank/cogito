import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef
} from '@i-thinking/design/components/resizable'
import { Spinner } from '@i-thinking/design/components/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@i-thinking/design/components/alert-dialog'
import { cn } from 'cn'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useCorexStore } from '@/stores/corex.ts'
import { nextStepId, nextToken } from '@/views/directive/model/step-utils.ts'
import type { Step } from '@/views/directive/model/types.ts'
import { OrchestratorCanvas } from '@/views/directive/orchestrator/canvas/canvas.tsx'
import { OrchestratorCatalog } from '@/views/directive/orchestrator/catalog.tsx'
import { OrchestratorInspector } from '@/views/directive/orchestrator/inspector/inspector.tsx'
import { OrchestratorToolbar } from '@/views/directive/orchestrator/toolbar.tsx'
import { capsFromTriggers } from '@/views/directive/run/run-caps.ts'
import { RunPanel } from '@/views/directive/run/run-panel.tsx'

import styles from '@/views/directive/workspace.module.scss'

const PANEL_ANIMATION_MS = 240

function DirectiveWorkspace() {
  const params = useParams()
  const name = decodeURIComponent(params.name ?? '')
  const navigate = useNavigate()
  const catalogRef = usePanelRef()
  const inspectorRef = usePanelRef()
  const runRef = usePanelRef()
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isCatalogOpen, setCatalogOpen] = useState(true)
  const [isInspectorOpen, setInspectorOpen] = useState(true)
  const [isRunOpen, setRunOpen] = useState(true)
  const [isPanelAnimating, setPanelAnimating] = useState(false)

  function withPanelAnimation(update: () => void) {
    setPanelAnimating(true)
    update()
    if (animationTimer.current) clearTimeout(animationTimer.current)
    animationTimer.current = setTimeout(function () {
      setPanelAnimating(false)
      animationTimer.current = null
    }, PANEL_ANIMATION_MS)
  }

  const directives = useCorexStore(function (state) {
    return state.directives
  })
  const draft = useCorexStore(function (state) {
    return state.draft
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
  const initialize = useCorexStore(function (state) {
    return state.initialize
  })
  const openEditor = useCorexStore(function (state) {
    return state.openEditor
  })
  const seedPendingDraft = useCorexStore(function (state) {
    return state.seedPendingDraft
  })
  const loadEditor = useCorexStore(function (state) {
    return state.loadEditor
  })
  const closeEditor = useCorexStore(function (state) {
    return state.closeEditor
  })
  const replaceDraft = useCorexStore(function (state) {
    return state.replaceDraft
  })
  const setSelectedToken = useCorexStore(function (state) {
    return state.setSelectedToken
  })
  const undoDraft = useCorexStore(function (state) {
    return state.undoDraft
  })
  const redoDraft = useCorexStore(function (state) {
    return state.redoDraft
  })
  const isDraftDirty = useCorexStore(function (state) {
    return state.isDraftDirty
  })
  const validateDraft = useCorexStore(function (state) {
    return state.validateDraft
  })
  const saveDraft = useCorexStore(function (state) {
    return state.saveDraft
  })
  const startRun = useCorexStore(function (state) {
    return state.startRun
  })
  const deleteDirectiveFromHost = useCorexStore(function (state) {
    return state.deleteDirectiveFromHost
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

  const caps = useMemo(
    function () {
      return capsFromTriggers(draft?.triggers)
    },
    [draft?.triggers]
  )

  const stepCount = Array.isArray(draft?.steps) ? draft.steps.length : (entry?.summary?.step_count ?? 0)
  const inputCount = Array.isArray(draft?.inputs)
    ? draft.inputs.length
    : (entry?.summary?.input_count ?? 0)

  const blocker = useBlocker(isDirty)

  useEffect(
    function () {
      void initialize()
    },
    [initialize]
  )

  useEffect(
    function () {
      const panel = catalogRef.current
      if (!panel) return
      if (isCatalogOpen) panel.expand()
      else panel.collapse()
    },
    [isCatalogOpen, catalogRef]
  )

  useEffect(
    function () {
      const panel = inspectorRef.current
      if (!panel) return
      if (isInspectorOpen) panel.expand()
      else panel.collapse()
    },
    [isInspectorOpen, inspectorRef]
  )

  useEffect(
    function () {
      const panel = runRef.current
      if (!panel) return
      if (isRunOpen) panel.expand()
      else panel.collapse()
    },
    [isRunOpen, runRef]
  )

  useEffect(
    function () {
      return function () {
        if (animationTimer.current) clearTimeout(animationTimer.current)
      }
    },
    []
  )

  useEffect(
    function () {
      if (!name) return
      openEditor(name, isPending)
      if (isPending) {
        seedPendingDraft(name)
        return function () {
          closeEditor()
        }
      }
      void loadEditor(name)
        .then(function () {
          const current = useCorexStore.getState().draft
          const first = current?.steps?.[0] as Step | undefined
          if (first?.token) setSelectedToken(first.token)
        })
        .catch(function (error) {
          toast.error('加载指令失败', {
            description: error instanceof Error ? error.message : String(error)
          })
        })
      return function () {
        closeEditor()
      }
    },
    [name, isPending, openEditor, seedPendingDraft, loadEditor, closeEditor, setSelectedToken]
  )

  const handleSave = useCallback(
    async function () {
      const savedName = await saveDraft()
      if (savedName && savedName !== name) {
        void navigate('/directive/' + encodeURIComponent(savedName), { replace: true })
      }
    },
    [saveDraft, name, navigate]
  )

  const handleValidate = useCallback(
    async function () {
      try {
        await validateDraft()
        toast.success('校验通过')
      } catch (error) {
        toast.error('校验失败', {
          description: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [validateDraft]
  )

  const handleOnce = useCallback(
    async function () {
      const target = draft?.name ?? name
      if (!target) return
      if (isDirty) {
        const saved = await saveDraft()
        if (!saved) return
        setRunOpen(true)
        startRun(saved, {})
        return
      }
      setRunOpen(true)
      startRun(target, {})
    },
    [draft?.name, name, isDirty, saveDraft, startRun]
  )

  const beforeGuard = useCallback(
    async function () {
      if (!isDirty) return draft?.name ?? name
      try {
        return await saveDraft()
      } catch {
        return null
      }
    },
    [isDirty, draft?.name, name, saveDraft]
  )

  const handleDelete = useCallback(
    async function () {
      const target = draft?.name ?? name
      await deleteDirectiveFromHost(target)
      toast.success('已删除')
    },
    [deleteDirectiveFromHost, draft?.name, name]
  )

  useEffect(
    function () {
      function onKeyDown(event: KeyboardEvent) {
        const target = event.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        const isTyping =
          tag === 'input' || tag === 'textarea' || target?.isContentEditable === true
        const withMod = event.metaKey || event.ctrlKey
        if (!withMod) return

        if (event.key === 's') {
          event.preventDefault()
          void handleSave()
          return
        }
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault()
          void handleValidate()
          return
        }
        if (isTyping) return
        if (event.key === 'Enter') {
          event.preventDefault()
          void handleOnce()
          return
        }
        if (event.key === 'z' && !event.shiftKey) {
          event.preventDefault()
          undoDraft()
          return
        }
        if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
          event.preventDefault()
          redoDraft()
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [handleSave, handleValidate, handleOnce, undoDraft, redoDraft]
  )

  function insertAction(actionId: string) {
    if (!draft) return
    const siblings = draft.steps as Step[]
    const step: Step = {
      id: nextStepId(actionId, siblings),
      token: nextToken(),
      action: actionId,
      params: {}
    }
    replaceDraft({
      ...draft,
      steps: [...siblings, step] as typeof draft.steps
    })
    setSelectedToken(step.token ?? null)
  }

  if (!name) {
    return <p className="p-6 text-sm text-muted-foreground">未指定指令名称。</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <OrchestratorToolbar
        name={draft?.name ?? name}
        description={draft?.description ?? entry?.summary?.description}
        bucket={draft?.bucket ?? entry?.bucket}
        folder={entry?.folder}
        stepCount={stepCount}
        inputCount={inputCount}
        caps={caps}
        isDirty={isDirty}
        isSaving={isSaving}
        isPending={isPending}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        isCatalogOpen={isCatalogOpen}
        isInspectorOpen={isInspectorOpen}
        isRunOpen={isRunOpen}
        onToggleCatalog={function () {
          withPanelAnimation(function () {
            setCatalogOpen(!isCatalogOpen)
          })
        }}
        onToggleInspector={function () {
          withPanelAnimation(function () {
            setInspectorOpen(!isInspectorOpen)
          })
        }}
        onToggleRun={function () {
          withPanelAnimation(function () {
            setRunOpen(!isRunOpen)
          })
        }}
        onBack={function () {
          void navigate('/directive')
        }}
        onSave={handleSave}
        onUndo={undoDraft}
        onRedo={redoDraft}
        onValidate={function () {
          void handleValidate()
        }}
        onOnce={handleOnce}
        beforeGuard={beforeGuard}
        onDelete={handleDelete}
        onDeleted={function () {
          void navigate('/directive')
        }}
      />

      <ResizablePanelGroup
        orientation="vertical"
        className={cn('min-h-0 flex-1', isPanelAnimating && styles.panesAnimating)}>
        <ResizablePanel
          id="directive-editor"
          defaultSize="68%"
          minSize={240}
          className="min-h-0 overflow-hidden">
          <ResizablePanelGroup
            id="directive-editor-panes"
            orientation="horizontal"
            className={cn('min-h-0 h-full', isPanelAnimating && styles.panesAnimating)}>
            <ResizablePanel
              id="directive-catalog"
              panelRef={catalogRef}
              defaultSize="22%"
              minSize={200}
              maxSize="34%"
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={function () {
                const nextOpen = !(catalogRef.current?.isCollapsed() ?? false)
                if (nextOpen !== isCatalogOpen) setCatalogOpen(nextOpen)
              }}
              className="min-h-0 min-w-0 overflow-hidden">
              <div
                className={cn(
                  styles.panelBody,
                  !isCatalogOpen && styles.panelBodyCollapsed
                )}>
                <OrchestratorCatalog onInsertAction={insertAction} />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="directive-canvas"
              defaultSize="48%"
              minSize={280}
              className="min-h-0 min-w-0 overflow-hidden">
              {isEditorLoading || !draft ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner className="size-6 text-muted-foreground" />
                </div>
              ) : (
                <OrchestratorCanvas
                  draft={draft}
                  selectedToken={selectedToken}
                  onSelectToken={setSelectedToken}
                  onChange={function (next) {
                    replaceDraft(next)
                  }}
                />
              )}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="directive-inspector"
              panelRef={inspectorRef}
              defaultSize="30%"
              minSize={260}
              collapsible
              collapsedSize={0}
              groupResizeBehavior="preserve-pixel-size"
              onResize={function () {
                const nextOpen = !(inspectorRef.current?.isCollapsed() ?? false)
                if (nextOpen !== isInspectorOpen) setInspectorOpen(nextOpen)
              }}
              className="min-h-0 min-w-0 overflow-hidden">
              <div
                className={cn(
                  styles.panelBody,
                  !isInspectorOpen && styles.panelBodyCollapsed
                )}>
                {draft ? (
                  <OrchestratorInspector
                    draft={draft}
                    selectedToken={selectedToken}
                    onChange={function (next) {
                      replaceDraft(next)
                    }}
                  />
                ) : null}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          id="directive-run"
          panelRef={runRef}
          defaultSize="32%"
          minSize={160}
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
          onResize={function () {
            const nextOpen = !(runRef.current?.isCollapsed() ?? false)
            if (nextOpen !== isRunOpen) setRunOpen(nextOpen)
          }}
          className="min-h-0 overflow-hidden">
          <div className={cn(styles.panelBody, !isRunOpen && styles.panelBodyCollapsed)}>
            <RunPanel directiveName={draft?.name ?? name} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前指令有未保存修改，离开将丢失这些更改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={function () {
                blocker.reset?.()
              }}>
              留下
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                blocker.proceed?.()
              }}>
              离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default DirectiveWorkspace
