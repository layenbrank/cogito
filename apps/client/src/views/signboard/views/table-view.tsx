import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { useMemo } from 'react'
import { toast } from 'sonner'

import {
  useSignboardStore,
  type SignboardEntry,
  type SignboardCheck,
  type SignboardColumn,
  type SignboardTag
} from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface TableViewProps {
  columns: SignboardColumn[]
  entries: SignboardEntry[]
  tagsByCard: Map<string, SignboardTag[]>
  isDimmedCard: (entryID: string) => boolean
  onOpenCard: (entryID: string) => void
}

const PRIORITY_LABELS = ['无', '低', '中', '高', '紧急'] as const

function formatDue(dueAt: number | null) {
  if (dueAt == null) return '—'
  const date = new Date(dueAt)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${m}-${d}`
}

function checklistProgress(items: SignboardCheck[]) {
  if (items.length === 0) return '—'
  const done = items.filter(function (item) {
    return item.done
  }).length
  return `${done}/${items.length}`
}

function TableView(props: TableViewProps) {
  const toMoveEntry = useSignboardStore(function (state) {
    return state.toMoveEntry
  })
  const checksForEntry = useSignboardStore(function (state) {
    return state.checksForEntry
  })
  const entriesInColumn = useSignboardStore(function (state) {
    return state.entriesInColumn
  })

  const columnByID = useMemo(
    function () {
      const map = new Map<string, SignboardColumn>()
      for (const column of props.columns) {
        map.set(column.id, column)
      }
      return map
    },
    [props.columns]
  )

  const rows = useMemo(
    function () {
      return props.entries
        .filter(function (card) {
          return card.archivedAt == null
        })
        .slice()
        .sort(function (a, b) {
          const colA = columnByID.get(a.columnID)?.index ?? 0
          const colB = columnByID.get(b.columnID)?.index ?? 0
          if (colA !== colB) return colA - colB
          return a.index - b.index
        })
    },
    [props.entries, columnByID]
  )

  async function moveToColumn(card: SignboardEntry, columnID: string) {
    if (card.columnID === columnID) return
    const ok = await toMoveEntry(card.id, columnID, entriesInColumn(columnID).length)
    if (!ok) toast.error('状态更新失败')
  }

  return (
    <div className={styles.paneView}>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>标题</th>
              <th>状态</th>
              <th>优先级</th>
              <th>到期</th>
              <th>标签</th>
              <th>清单</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(function (card) {
              const tags = props.tagsByCard.get(card.id) ?? []
              const dimmed = props.isDimmedCard(card.id)
              return (
                <tr
                  key={card.id}
                  className={dimmed ? styles.tableRowDimmed : undefined}
                  onClick={function () {
                    props.onOpenCard(card.id)
                  }}>
                  <td className={styles.tableTitle}>{card.title}</td>
                  <td
                    onClick={function (event) {
                      event.stopPropagation()
                    }}>
                    <Select
                      items={props.columns.map(function (column) {
                        return { value: column.id, label: column.title }
                      })}
                      value={card.columnID}
                      onValueChange={function (value) {
                        if (value === null) return
                        void moveToColumn(card, value)
                      }}>
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {props.columns.map(function (column) {
                          return (
                            <SelectItem
                              key={column.id}
                              value={column.id}>
                              {column.title}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </td>
                  <td>{PRIORITY_LABELS[card.priority] ?? card.priority}</td>
                  <td>{formatDue(card.dueAt)}</td>
                  <td>
                    <div className={styles.tableTags}>
                      {tags.slice(0, 3).map(function (tag) {
                        return (
                          <span
                            key={tag.id}
                            className={styles.tag}>
                            {tag.title}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td>{checklistProgress(checksForEntry(card.id))}</td>
                </tr>
              )
            })}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className={styles.tableEmpty}>
                  暂无卡片
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export { TableView }
