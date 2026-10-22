import type { RefObject } from 'react'

import type { PresentInput } from '@/components/contextmenu/host'
import {
  copyAnnotations,
  deleteAnnotations,
  groupAnnotations,
  moveAnnotationsLayer,
  toggleAnnotationsLock,
  ungroupAnnotations
} from '@/features/capture/capture-annotation-ops'
import { buildCaptureContextMenuItems } from '@/features/capture/capture-context-menu'
import {
  expandSelectionIDs,
  removeSelectionGroup
} from '@/features/capture/capture-selection'
import type { AnnotationHandle } from '@/features/capture/components/annotation'
import type { GraphicsEnum, GraphicsProps } from '@/features/capture/components/graphics'
import { createCaptureExport } from '@/features/capture/capture-export'
import type { CaptureHistorySnapshot } from '@/features/capture/use-capture-history'
import type { Phase } from '@/features/capture/use-capture-stage'

interface CaptureActionsInput {
  annotations: GraphicsProps[]
  selectedIDs: string[]
  selection: { x: number; y: number; w: number; h: number } | null
  phase: Phase
  annotationRef: RefObject<AnnotationHandle | null>
  presentContextMenu: (payload: PresentInput) => void
  commitHistory: (next: GraphicsProps[], selectedIDs?: string[]) => void
  undo: () => CaptureHistorySnapshot | null
  redo: () => CaptureHistorySnapshot | null
  resetHistory: () => void
  resetDragState: () => void
  onUpdateAnnotations: (next: GraphicsProps[]) => void
  onUpdateSelectedIDs: (ids: string[]) => void
  onUpdateSelectedID: (id: string | null) => void
  onUpdateColor: (color: string) => void
  onUpdateThickness: (thickness: number) => void
  onUpdateFilled: (filled: boolean) => void
  onUpdateOpacity: (opacity: number) => void
  onUpdateFontSize: (fontSize: number) => void
  onUpdateGraphics: (shape: GraphicsEnum | null) => void
  onUpdatePhase: (phase: Phase) => void
  onUpdateSelection: (selection: { x: number; y: number; w: number; h: number } | null) => void
  onExit?: () => void
  onTexture?: (input: { src: string; w: number; h: number }) => void
  sessionID: string
  onHistoryWritten?: () => void
}

function useCaptureActions(input: CaptureActionsInput) {
  function commitSelection(nextIDs: string[]) {
    input.onUpdateSelectedIDs(nextIDs)
    input.onUpdateSelectedID(nextIDs[nextIDs.length - 1] ?? null)
  }

  function syncToolbarFromAnnotation(item: GraphicsProps) {
    input.onUpdateColor(item.color)
    input.onUpdateThickness(item.thickness ?? 2)
    if (item.opacity !== null && item.opacity !== undefined) input.onUpdateOpacity(item.opacity)
    if (item.filled !== null && item.filled !== undefined) input.onUpdateFilled(item.filled)
    if (item.fontSize !== null && item.fontSize !== undefined) {
      input.onUpdateFontSize(item.fontSize)
    }
  }

  function restoreSnapshot(snapshot: CaptureHistorySnapshot) {
    input.onUpdateAnnotations(snapshot.annotations)
    const valid = snapshot.selectedIDs.filter(function (id) {
      return snapshot.annotations.some(function (a) {
        return a.id === id
      })
    })
    commitSelection(valid)
  }

  function handleUndo() {
    const snapshot = input.undo()
    if (!snapshot) return
    restoreSnapshot(snapshot)
  }

  function handleRedo() {
    const snapshot = input.redo()
    if (!snapshot) return
    restoreSnapshot(snapshot)
  }

  function handleDelete() {
    if (input.selectedIDs.length === 0) return
    const ids = expandSelectionIDs(input.selectedIDs, input.annotations)
    const next = deleteAnnotations(input.annotations, ids)
    input.onUpdateAnnotations(next)
    input.commitHistory(next, [])
    commitSelection([])
  }

  function handleUpdateGraphics(next: GraphicsEnum | null) {
    input.onUpdateGraphics(next)
    if (next) {
      input.onUpdatePhase('annotating')
      commitSelection([])
      return
    }
    if (input.selection) input.onUpdatePhase('editing')
  }

  function handleSelect(id: string | null, options?: { additive?: boolean }) {
    if (!id) {
      commitSelection([])
      return
    }
    const current = input.annotations.find(function (a) {
      return a.id === id
    })
    if (!current) return

    if (options?.additive) {
      const exists = input.selectedIDs.includes(id)
      const nextIDs = exists
        ? removeSelectionGroup(input.selectedIDs, id, input.annotations)
        : expandSelectionIDs([...input.selectedIDs, id], input.annotations)
      commitSelection(nextIDs)
    } else {
      commitSelection(expandSelectionIDs([id], input.annotations))
    }
    syncToolbarFromAnnotation(current)
  }

  function handleSelectMany(ids: string[]) {
    if (ids.length === 0) {
      commitSelection([])
      return
    }
    const expanded = expandSelectionIDs(ids, input.annotations)
    if (expanded.length === 0) {
      commitSelection([])
      return
    }
    commitSelection(expanded)
    const primaryID = expanded[expanded.length - 1]
    const current = primaryID
      ? input.annotations.find(function (a) {
          return a.id === primaryID
        })
      : undefined
    if (current) syncToolbarFromAnnotation(current)
  }

  function applyAnnotations(next: GraphicsProps[], nextSelection?: string[]) {
    input.onUpdateAnnotations(next)
    input.commitHistory(next, nextSelection ?? input.selectedIDs)
    if (nextSelection) commitSelection(nextSelection)
  }

  function handleContextMenuAnnotation(payload: {
    id: string
    clientX: number
    clientY: number
    keepSelection?: boolean
  }) {
    const target = input.annotations.find(function (a) {
      return a.id === payload.id
    })
    if (!target) return

    let menuIDs = input.selectedIDs
    if (!payload.keepSelection && !input.selectedIDs.includes(payload.id)) {
      if (target.groupID) {
        menuIDs = input.annotations
          .filter(function (a) {
            return a.groupID === target.groupID
          })
          .map(function (a) {
            return a.id
          })
      } else {
        menuIDs = [payload.id]
      }
      commitSelection(menuIDs)
      syncToolbarFromAnnotation(target)
    } else if (menuIDs.length === 0) {
      menuIDs = [payload.id]
    }

    const actionIDs = menuIDs.includes(payload.id) ? menuIDs : [payload.id]
    const items = buildCaptureContextMenuItems({
      annotations: input.annotations,
      target,
      actionIDs,
      actions: {
        moveLayer(ids, direction) {
          const next = moveAnnotationsLayer(input.annotations, ids, direction)
          if (next) applyAnnotations(next)
        },
        group(ids) {
          const next = groupAnnotations(input.annotations, ids)
          if (next) applyAnnotations(next, ids)
        },
        ungroup(groupID) {
          applyAnnotations(ungroupAnnotations(input.annotations, groupID))
        },
        toggleLock(ids) {
          const result = toggleAnnotationsLock(input.annotations, ids)
          if (!result) return
          input.onUpdateAnnotations(result.next)
          input.commitHistory(result.next, result.nextLocked ? [] : input.selectedIDs)
          if (result.nextLocked) commitSelection([])
        },
        copy(ids) {
          const result = copyAnnotations(input.annotations, ids)
          if (result) applyAnnotations(result.next, result.cloneIDs)
        },
        remove(ids) {
          applyAnnotations(deleteAnnotations(input.annotations, ids), [])
        }
      }
    })

    input.presentContextMenu({
      x: payload.clientX,
      y: payload.clientY,
      items
    })
  }

  function handleAnnotationChange(next: GraphicsProps, options?: { history?: boolean }) {
    const shouldCommit = options?.history !== false
    const updated = input.annotations.map(function (v) {
      return v.id === next.id ? next : v
    })
    input.onUpdateAnnotations(updated)
    if (shouldCommit) input.commitHistory(updated, input.selectedIDs)
  }

  function handleAnnotationsBatchChange(nexts: GraphicsProps[]) {
    if (nexts.length === 0) return
    const map = new Map(
      nexts.map(function (item) {
        return [item.id, item] as const
      })
    )
    const updated = input.annotations.map(function (v) {
      return map.get(v.id) ?? v
    })
    input.onUpdateAnnotations(updated)
    input.commitHistory(updated, input.selectedIDs)
  }

  function applyPropertyToSelected(patch: Partial<GraphicsProps>) {
    if (input.selectedIDs.length === 0) return
    const ids = expandSelectionIDs(input.selectedIDs, input.annotations)
    const idSet = new Set(ids)
    const updated = input.annotations.map(function (v) {
      return idSet.has(v.id) ? { ...v, ...patch } : v
    })
    input.onUpdateAnnotations(updated)
    input.commitHistory(updated, input.selectedIDs)
  }

  function handleUpdateColor(next: string) {
    input.onUpdateColor(next)
    applyPropertyToSelected({ color: next })
  }
  function handleUpdateThickness(next: number) {
    input.onUpdateThickness(next)
    applyPropertyToSelected({ thickness: next })
  }
  function handleUpdateFilled(next: boolean) {
    input.onUpdateFilled(next)
    applyPropertyToSelected({ filled: next })
  }
  function handleUpdateOpacity(next: number) {
    input.onUpdateOpacity(next)
    applyPropertyToSelected({ opacity: next })
  }
  function handleUpdateFontSize(next: number) {
    input.onUpdateFontSize(next)
    applyPropertyToSelected({ fontSize: next })
  }

  function handleRefresh() {
    input.onUpdateSelection(null)
    input.onUpdateGraphics(null)
    commitSelection([])
    input.onUpdateAnnotations([])
    input.onUpdatePhase('selecting')
    input.resetDragState()
    input.resetHistory()
  }

  function handleEscape() {
    if (input.phase === 'annotating') {
      handleUpdateGraphics(null)
      return
    }
    if (input.selectedIDs.length > 0) {
      handleSelect(null)
      return
    }
    if (input.selection) {
      handleRefresh()
      return
    }
    input.onExit?.()
  }

  const exportActions = createCaptureExport({
    annotationRef: input.annotationRef,
    sessionID: input.sessionID,
    onExit: input.onExit,
    onTexture: input.onTexture,
    onHistoryWritten: input.onHistoryWritten
  })

  return {
    handleUndo,
    handleRedo,
    handleDelete,
    handleUpdateGraphics,
    handleSelect,
    handleSelectMany,
    handleContextMenuAnnotation,
    handleAnnotationChange,
    handleAnnotationsBatchChange,
    handleUpdateColor,
    handleUpdateThickness,
    handleUpdateFilled,
    handleUpdateOpacity,
    handleUpdateFontSize,
    handleRefresh,
    handleEscape,
    ...exportActions
  }
}

export { useCaptureActions }
