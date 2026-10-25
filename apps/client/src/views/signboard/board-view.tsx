import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@cogito/design/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'
import { debounce } from 'lodash-es'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { findPref, patchPref, type SignboardViewMode } from '@/features/persist'
import { useSignboardStore, type SignboardColumn, type SignboardTag } from '@/stores/signboard'
import { AutomationSheet } from '@/views/signboard/automation-sheet'
import { CardSheet } from '@/views/signboard/card-sheet'
import { EmptyAtmosphere } from '@/views/signboard/empty-atmosphere'
import { NameDialog } from '@/views/signboard/name-dialog'
import styles from '@/views/signboard/signboard.module.scss'
import { TagFilter } from '@/views/signboard/tag-filter'
import { ViewModeSelect, type ViewMode } from '@/views/signboard/view-tabs'
import { CalendarView } from '@/views/signboard/views/calendar-view'
import { GanttView } from '@/views/signboard/views/gantt-view'
import { KanbanView } from '@/views/signboard/views/kanban-view'
import { StatsView } from '@/views/signboard/views/stats-view'
import { TableView } from '@/views/signboard/views/table-view'
import { WorkloadView } from '@/views/signboard/views/workload-view'

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

function BoardView() {
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

  const applySearch = useMemo(
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
        applySearch.cancel()
      }
    },
    [applySearch]
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
        const ids = tagIDsForEntry(card.id)
        map.set(
          card.id,
          tags.filter(function (tag) {
            return ids.includes(tag.id)
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
      const ids = tagIDsForEntry(entryID)
      const hit = tagFilters.some(function (tagID) {
        return ids.includes(tagID)
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

  if (!loaded) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-5" />
        加载看板…
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {orderedColumns.length === 0 ? <EmptyAtmosphere /> : null}

      <div className={styles.chrome}>
        <div className={styles.chromeMeta}>
          <Select
            items={boards.map(function (board) {
              return { value: board.id, label: board.title }
            })}
            value={activeBoardID}
            onValueChange={function (value) {
              if (value === null) return
              void toActivateBoard(value)
            }}>
            <SelectTrigger
              size="sm"
              className="h-8 w-40">
              <SelectValue placeholder="选择看板" />
            </SelectTrigger>
            <SelectContent>
              {boards.map(function (board) {
                return (
                  <SelectItem
                    key={board.id}
                    value={board.id}>
                    {board.title}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <ViewModeSelect
            value={viewMode}
            onChange={changeViewMode}
          />
          <p className={styles.chromeHint}>
            {entries.length} 张 · {orderedColumns.length} 列
          </p>
        </div>

        <div className={styles.chromeTools}>
          <div className={styles.filters}>
            <InputGroup className="h-8 w-40">
              <InputGroupInput
                id="signboard-search"
                className="h-8"
                placeholder="搜索卡片…"
                value={search}
                onChange={function (event) {
                  setSearch(event.target.value)
                  applySearch(event.target.value)
                }}
              />
              <InputGroupAddon>
                <Icon
                  icon="lucide:search"
                  className="size-3.5 opacity-50"
                />
              </InputGroupAddon>
            </InputGroup>
            <Button
              type="button"
              size="sm"
              className={overdueOnly ? styles.filterChipOn : styles.filterChip}
              variant={overdueOnly ? 'secondary' : 'ghost'}
              aria-pressed={overdueOnly}
              title="只显示已过截止日的卡片"
              onClick={function () {
                setOverdueOnly(function (prev) {
                  return !prev
                })
              }}>
              <Icon
                icon="lucide:calendar-clock"
                className="size-3.5"
              />
              已到期
            </Button>
            <TagFilter
              tags={tags}
              selectedIDs={tagFilters}
              boardID={activeBoardID}
              onChange={setTagFilters}
            />
          </div>

          <div className={styles.chromeActions}>
            <Button
              type="button"
              size="sm"
              className="h-8 px-3"
              onClick={function () {
                const first = orderedColumns[0]
                if (!first) {
                  setAddingColumn(true)
                  changeViewMode('board')
                  toast.message('请先添加一列')
                  return
                }
                changeViewMode('board')
                setAddRequestColumnID(first.id)
              }}>
              <Icon
                icon="lucide:plus"
                className="size-3.5"
              />
              新建卡片
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label="更多操作"
                  />
                }>
                <Icon
                  icon="lucide:ellipsis"
                  className="size-3.5"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={function () {
                    setAddingColumn(true)
                    changeViewMode('board')
                  }}>
                  <Icon
                    icon="lucide:columns-3"
                    className="size-4"
                  />
                  添加列
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={function () {
                    setAutomationOpen(true)
                  }}>
                  <Icon
                    icon="lucide:zap"
                    className="size-4"
                  />
                  自动化
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={function () {
                    setNameDialog({ kind: 'board-create' })
                  }}>
                  <Icon
                    icon="lucide:layout-dashboard"
                    className="size-4"
                  />
                  新建看板
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!activeBoard}
                  onClick={function () {
                    if (!activeBoard) return
                    setNameDialog({
                      kind: 'board-rename',
                      boardID: activeBoard.id,
                      title: activeBoard.title
                    })
                  }}>
                  <Icon
                    icon="lucide:pencil"
                    className="size-4"
                  />
                  重命名看板
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {viewMode === 'board' ? (
        <KanbanView
          columns={orderedColumns}
          entries={entries}
          tagsByCard={tagsByCard}
          isDimmedCard={isDimmedCard}
          selectedCardID={selectedCardID}
          addRequestColumnID={addRequestColumnID}
          addingColumn={addingColumn}
          columnDraft={columnDraft}
          onColumnDraftChange={setColumnDraft}
          onAddingColumnChange={setAddingColumn}
          onConsumedAddRequest={function () {
            setAddRequestColumnID(null)
          }}
          onOpenCard={openCard}
          onFocusCard={setSelectedCardID}
          onRenameColumn={function (column) {
            setNameDialog({ kind: 'column-rename', column })
          }}
          onArchiveColumn={function (columnID) {
            void archiveColumn(columnID)
          }}
          onArchiveCard={function (entryID) {
            void archiveCard(entryID)
          }}
          onCommitColumn={commitColumn}
        />
      ) : null}

      {viewMode === 'table' ? (
        <TableView
          columns={orderedColumns}
          entries={entries}
          tagsByCard={tagsByCard}
          isDimmedCard={isDimmedCard}
          onOpenCard={openCard}
        />
      ) : null}

      {viewMode === 'gantt' ? (
        <GanttView
          columns={orderedColumns}
          entries={entries}
          onOpenCard={openCard}
        />
      ) : null}

      {viewMode === 'calendar' ? (
        <CalendarView
          entries={entries}
          onOpenCard={openCard}
        />
      ) : null}

      {viewMode === 'stats' ? (
        <StatsView
          columns={orderedColumns}
          entries={entries}
        />
      ) : null}

      {viewMode === 'workload' ? <WorkloadView columns={orderedColumns} /> : null}

      <p className={styles.footerHint}>
        {viewMode === 'board'
          ? '拖手柄调序 · ⌘/Ctrl+N 新建 · ⌘/Ctrl+F 搜索'
          : '点条目打开详情 · 菜单可配自动化'}
      </p>

      <CardSheet
        key={activeCard?.id ?? 'closed'}
        card={activeCard ?? null}
        open={sheetOpen}
        onUpdateOpen={setSheetOpen}
      />

      <AutomationSheet
        open={automationOpen}
        onUpdateOpen={setAutomationOpen}
        boardID={activeBoardID}
        columns={orderedColumns}
        tags={tags}
      />

      <NameDialog
        key={nameDialog?.kind === 'board-create' ? 'board-create' : 'board-create-idle'}
        open={nameDialog?.kind === 'board-create'}
        title="新建看板"
        description="用于区分工作流主题，例如个人、副业或项目代号。"
        placeholder="例如：本周交付"
        confirmLabel="创建"
        onClose={function () {
          setNameDialog(null)
        }}
        onConfirm={async function (title) {
          const id = await toWriteBoard(title)
          if (!id) {
            toast.error('创建看板失败')
            throw new Error('create board failed')
          }
          toast.success('已创建看板')
        }}
      />

      <NameDialog
        key={
          nameDialog?.kind === 'board-rename'
            ? `board-rename-${nameDialog.boardID}`
            : 'board-rename-idle'
        }
        open={nameDialog?.kind === 'board-rename'}
        title="重命名看板"
        initialValue={nameDialog?.kind === 'board-rename' ? nameDialog.title : ''}
        confirmLabel="保存"
        onClose={function () {
          setNameDialog(null)
        }}
        onConfirm={async function (title) {
          if (nameDialog?.kind !== 'board-rename') return
          const ok = await toUpdateBoard(nameDialog.boardID, { title })
          if (!ok) {
            toast.error('重命名失败')
            throw new Error('rename board failed')
          }
          toast.success('已重命名')
        }}
      />

      <NameDialog
        key={
          nameDialog?.kind === 'column-rename'
            ? `column-rename-${nameDialog.column.id}`
            : 'column-rename-idle'
        }
        open={nameDialog?.kind === 'column-rename'}
        title="重命名列"
        initialValue={nameDialog?.kind === 'column-rename' ? nameDialog.column.title : ''}
        confirmLabel="保存"
        onClose={function () {
          setNameDialog(null)
        }}
        onConfirm={async function (title) {
          if (nameDialog?.kind !== 'column-rename') return
          const ok = await toUpdateColumn(nameDialog.column.id, { title })
          if (!ok) {
            toast.error('重命名失败')
            throw new Error('rename column failed')
          }
          toast.success('已重命名列')
        }}
      />
    </div>
  )
}

export { BoardView }
