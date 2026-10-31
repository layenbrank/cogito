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
import { toast } from 'sonner'

import { EmptyAtmosphere } from '@/views/signboard/empty-atmosphere'
import styles from '@/views/signboard/signboard.module.scss'
import { TagFilter } from '@/views/signboard/tag-filter'
import type { useBoardView } from '@/views/signboard/use-board-view.ts'
import { ViewModeSelect } from '@/views/signboard/view-tabs'
import { CalendarView } from '@/views/signboard/views/calendar-view'
import { GanttView } from '@/views/signboard/views/gantt-view'
import { KanbanView } from '@/views/signboard/views/kanban-view'
import { StatsView } from '@/views/signboard/views/stats-view'
import { TableView } from '@/views/signboard/views/table-view'
import { WorkloadView } from '@/views/signboard/views/workload-view'

type BoardViewState = ReturnType<typeof useBoardView>

function BoardViewShell(props: BoardViewState) {
  return (
    <div className={styles.root}>
      {props.orderedColumns.length === 0 ? <EmptyAtmosphere /> : null}

      <div className={styles.shell}>
        <div className={styles.shellMeta}>
          <Select
            items={props.boards.map(function (board) {
              return { value: board.id, label: board.title }
            })}
            value={props.activeBoardID}
            onValueChange={function (value) {
              if (value === null) return
              void props.toActivateBoard(value)
            }}>
            <SelectTrigger
              size="sm"
              className="h-8 w-40">
              <SelectValue placeholder="选择看板" />
            </SelectTrigger>
            <SelectContent>
              {props.boards.map(function (board) {
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
            value={props.viewMode}
            onChange={props.changeViewMode}
          />
          <p className={styles.shellHint}>
            {props.entries.length} 张 · {props.orderedColumns.length} 列
          </p>
        </div>

        <div className={styles.shellTools}>
          <div className={styles.filters}>
            <InputGroup className="h-8 w-40">
              <InputGroupInput
                id="signboard-search"
                className="h-8"
                placeholder="搜索卡片…"
                value={props.search}
                onChange={function (event) {
                  props.setSearch(event.target.value)
                  props.runSearch(event.target.value)
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
              className={props.overdueOnly ? styles.filterChipOn : styles.filterChip}
              variant={props.overdueOnly ? 'secondary' : 'ghost'}
              aria-pressed={props.overdueOnly}
              title="只显示已过截止日的卡片"
              onClick={function () {
                props.setOverdueOnly(function (prev) {
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
              tags={props.tags}
              selectedIDs={props.tagFilters}
              boardID={props.activeBoardID}
              onChange={props.setTagFilters}
            />
          </div>

          <div className={styles.shellActions}>
            <Button
              type="button"
              size="sm"
              className="h-8 px-3"
              onClick={function () {
                const first = props.orderedColumns[0]
                if (!first) {
                  props.setAddingColumn(true)
                  props.changeViewMode('board')
                  toast.message('请先添加一列')
                  return
                }
                props.changeViewMode('board')
                props.setAddRequestColumnID(first.id)
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
                    props.setAddingColumn(true)
                    props.changeViewMode('board')
                  }}>
                  <Icon
                    icon="lucide:columns-3"
                    className="size-4"
                  />
                  添加列
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={function () {
                    props.setAutomationOpen(true)
                  }}>
                  <Icon
                    icon="lucide:zap"
                    className="size-4"
                  />
                  自动化
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={function () {
                    props.setNameDialog({ kind: 'board-create' })
                  }}>
                  <Icon
                    icon="lucide:layout-dashboard"
                    className="size-4"
                  />
                  新建看板
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!props.activeBoard}
                  onClick={function () {
                    if (!props.activeBoard) return
                    props.setNameDialog({
                      kind: 'board-rename',
                      boardID: props.activeBoard.id,
                      title: props.activeBoard.title
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

      {props.viewMode === 'board' ? (
        <KanbanView
          columns={props.orderedColumns}
          entries={props.entries}
          tagsByCard={props.tagsByCard}
          isDimmedCard={props.isDimmedCard}
          selectedCardID={props.selectedCardID}
          addRequestColumnID={props.addRequestColumnID}
          addingColumn={props.addingColumn}
          columnDraft={props.columnDraft}
          onColumnDraftChange={props.setColumnDraft}
          onAddingColumnChange={props.setAddingColumn}
          onConsumedAddRequest={function () {
            props.setAddRequestColumnID(null)
          }}
          onOpenCard={props.openCard}
          onFocusCard={props.setSelectedCardID}
          onRenameColumn={function (column) {
            props.setNameDialog({ kind: 'column-rename', column })
          }}
          onArchiveColumn={function (columnID) {
            void props.archiveColumn(columnID)
          }}
          onArchiveCard={function (entryID) {
            void props.archiveCard(entryID)
          }}
          onCommitColumn={props.commitColumn}
        />
      ) : null}

      {props.viewMode === 'table' ? (
        <TableView
          columns={props.orderedColumns}
          entries={props.entries}
          tagsByCard={props.tagsByCard}
          isDimmedCard={props.isDimmedCard}
          onOpenCard={props.openCard}
        />
      ) : null}

      {props.viewMode === 'gantt' ? (
        <GanttView
          columns={props.orderedColumns}
          entries={props.entries}
          onOpenCard={props.openCard}
        />
      ) : null}

      {props.viewMode === 'calendar' ? (
        <CalendarView
          entries={props.entries}
          onOpenCard={props.openCard}
        />
      ) : null}

      {props.viewMode === 'stats' ? (
        <StatsView
          columns={props.orderedColumns}
          entries={props.entries}
        />
      ) : null}

      {props.viewMode === 'workload' ? <WorkloadView columns={props.orderedColumns} /> : null}

      <p className={styles.footerHint}>
        {props.viewMode === 'board'
          ? '拖手柄调序 · ⌘/Ctrl+N 新建 · ⌘/Ctrl+F 搜索'
          : '点条目打开详情 · 菜单可配自动化'}
      </p>
    </div>
  )
}

export { BoardViewShell }
