import { debounce } from 'lodash-es'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { findPref, patchPref, type SignboardViewMode } from '@/features/persist'
import { useSignboardStore, type SignboardColumn, type SignboardTag } from '@/stores/signboard'
import type { ViewMode } from '@/views/signboard/view-tabs'

type NameDialogState =
  | { kind: 'board-create' }
  | { kind: 'board-rename'; boardID: string; title: string }
  | { kind: 'column-rename'; column: SignboardColumn }
  | null

function readStoredView(boardID: string | null): ViewMode {
  if (!boardID) return 'board'
  return findPref('tiles').signboard.viewModeByBoard[boardID] ?? 'board'
}

function persistViewMode(boardID: string | null, mode: SignboardViewMode) {
  if (!boardID) return
  void patchPref('tiles', {
    signboard: {
      ...findPref('tiles').signboard,
      viewModeByBoard: {
        ...findPref('tiles').signboard.viewModeByBoard,
        [boardID]: mode
      }
    }
  })
}

function useBoardView() {
  const boards = useSignboardStore(function (state) {
    return state.boards
  })
  const columns = useSignboardStore(function (state) {
    return state.columns
  })
  const entries = useSignboardStore(function (state) {
    return state.entries
  })
  const tags = useSignboardStore(function (state) {
    return state.tags
  })
  const activeBoardID = useSignboardStore(function (state) {
    return state.activeBoardID
  })
  const loaded = useSignboardStore(function (state) {
    return state.loaded
  })
  const toBootstrap = useSignboardStore(function (state) {
    return state.toBootstrap
  })
  const toActivateBoard = useSignboardStore(function (state) {
    return state.toActivateBoard
  })
  const toWriteBoard = useSignboardStore(function (state) {
    return state.toWriteBoard
  })
  const toUpdateBoard = useSignboardStore(function (state) {
    return state.toUpdateBoard
  })
  const toWriteColumn = useSignboardStore(function (state) {
    return state.toWriteColumn
  })
  const toUpdateColumn = useSignboardStore(function (state) {
    return state.toUpdateColumn
  })
  const toUpdateEntry = useSignboardStore(function (state) {
    return state.toUpdateEntry
  })
  const entriesInColumn = useSignboardStore(function (state) {
    return state.entriesInColumn
  })
  const tagIDsForEntry = useSignboardStore(function (state) {
    return state.tagIDsForEntry
  })

  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [selectedCardID, setSelectedCardID] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [automationOpen, setAutomationOpen] = useState(false)
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [columnDraft, setColumnDraft] = useState('')
  const [addRequestColumnID, setAddRequestColumnID] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(function () {
    return readStoredView(activeBoardID)
  })
  const [viewBoardID, setViewBoardID] = useState(activeBoardID)

  if (activeBoardID !== viewBoardID) {
    setViewBoardID(activeBoardID)
    setViewMode(readStoredView(activeBoardID))
  }

  const runSearch = useMemo(
    function () {
      return debounce(function (value: string) {
        setQuery(value)
      }, 200)
    },
    []
  )

  useEffect(
    function () {
      void toBootstrap()
    },
    [toBootstrap]
  )

  useEffect(
    function () {
      return function () {
        runSearch.cancel()
      }
    },
    [runSearch]
  )

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode)
    persistViewMode(activeBoardID, mode)
  }

  const orderedColumns = useMemo(
    function () {
      return columns
        .filter(function (column) {
          return column.archivedAt === null || column.archivedAt === undefined
        })
        .slice()
        .sort(function (a, b) {
          return a.index - b.index
        })
    },
    [columns]
  )

  const activeBoard = boards.find(function (board) {
    return board.id === activeBoardID
  })

  const tagsByCard = useMemo(
    function () {
      const map = new Map<string, SignboardTag[]>()
      for (const card of entries) {
        const idSet = new Set(tagIDsForEntry(card.id))
        map.set(
          card.id,
          tags.filter(function (tag) {
            return idSet.has(tag.id)
          })
        )
      }
      return map
    },
    [entries, tags, tagIDsForEntry]
  )

  function isDimmedCard(entryID: string) {
    const card = entries.find(function (row) {
      return row.id === entryID
    })
    if (!card) return true
    const q = query.trim().toLowerCase()
    if (q) {
      const hay = `${card.title} ${card.notes}`.toLowerCase()
      if (!hay.includes(q)) return true
    }
    if (overdueOnly) {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      if (card.dueAt === null || card.dueAt === undefined || card.dueAt >= start.getTime()) {
        return true
      }
    }
    if (tagFilters.length > 0) {
      const idSet = new Set(tagIDsForEntry(entryID))
      const hit = tagFilters.some(function (tagID) {
        return idSet.has(tagID)
      })
      if (!hit) return true
    }
    return false
  }

  function openCard(entryID: string) {
    setSelectedCardID(entryID)
    setSheetOpen(true)
  }

  useEffect(
    function () {
      function onGlobalKey(event: globalThis.KeyboardEvent) {
        const target = event.target as HTMLElement | null
        const tag = target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

        const meta = event.metaKey || event.ctrlKey
        if (meta && event.key.toLowerCase() === 'n') {
          event.preventDefault()
          const first = orderedColumns[0]
          if (first) {
            setViewMode('board')
            persistViewMode(activeBoardID, 'board')
            setAddRequestColumnID(first.id)
          }
        }
        if (meta && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          document.getElementById('signboard-search')?.focus()
        }
      }
      window.addEventListener('keydown', onGlobalKey)
      return function () {
        window.removeEventListener('keydown', onGlobalKey)
      }
    },
    [orderedColumns, activeBoardID]
  )

  async function commitColumn() {
    const title = columnDraft.trim()
    if (!title || !activeBoardID) return
    const id = await toWriteColumn(activeBoardID, title)
    if (!id) {
      toast.error('添加列失败')
      return
    }
    setColumnDraft('')
    setAddingColumn(false)
    toast.success('已添加列')
  }

  async function archiveCard(entryID: string) {
    const ok = await toUpdateEntry(entryID, { archivedAt: Date.now() })
    if (!ok) {
      toast.error('归档失败')
      return
    }
    toast.success('已归档卡片')
  }

  async function archiveColumn(columnID: string) {
    const count = entriesInColumn(columnID).length
    if (count > 0) {
      toast.error('请先清空或移走列中的卡片')
      return
    }
    const ok = await toUpdateColumn(columnID, { archivedAt: Date.now() })
    if (!ok) {
      toast.error('归档列失败')
      return
    }
    toast.success('已归档列')
  }

  const activeCard = entries.find(function (card) {
    return card.id === selectedCardID
  })

  return {
    boards,
    entries,
    tags,
    activeBoardID,
    loaded,
    toActivateBoard,
    toWriteBoard,
    toUpdateBoard,
    toUpdateColumn,
    search,
    setSearch,
    runSearch,
    tagFilters,
    setTagFilters,
    overdueOnly,
    setOverdueOnly,
    selectedCardID,
    sheetOpen,
    setSheetOpen,
    automationOpen,
    setAutomationOpen,
    nameDialog,
    setNameDialog,
    addingColumn,
    setAddingColumn,
    columnDraft,
    setColumnDraft,
    addRequestColumnID,
    setAddRequestColumnID,
    viewMode,
    changeViewMode,
    orderedColumns,
    activeBoard,
    tagsByCard,
    isDimmedCard,
    openCard,
    setSelectedCardID,
    commitColumn,
    archiveCard,
    archiveColumn,
    activeCard
  }
}

export { useBoardView }
export type { NameDialogState }
