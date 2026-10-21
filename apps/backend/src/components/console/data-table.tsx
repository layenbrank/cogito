import { Button } from '@i-thinking/design/components/button'
import clsx from 'clsx'
import type { ReactNode } from 'react'

import { EmptyState } from '@/components/console/empty-state.tsx'

interface DataTableColumn<T> {
  key: string
  title: string
  render(row: T): ReactNode
  className?: string
  headerClassName?: string
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey(row: T): string
  emptyTitle?: string
  emptyDescription?: string
  emptyActionLabel?: string
  onEmptyAction?(): void
  onRowClick?(row: T): void
}

function DataTable<T>(props: DataTableProps<T>) {
  if (props.rows.length === 0) {
    return (
      <EmptyState
        title={props.emptyTitle ?? '暂无数据'}
        description={props.emptyDescription}
        actionLabel={props.emptyActionLabel}
        onAction={props.onEmptyAction}
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border/80 bg-muted/40">
            {props.columns.map(function (column) {
              return (
                <th
                  key={column.key}
                  className={clsx(
                    'sticky top-0 z-[1] h-10 px-3 text-left text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase whitespace-nowrap',
                    column.headerClassName,
                    column.className
                  )}>
                  {column.title}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {props.rows.map(function (row, rowIndex) {
            const isLast = rowIndex === props.rows.length - 1
            return (
              <tr
                key={props.rowKey(row)}
                className={clsx(
                  'transition-colors hover:bg-muted/35',
                  !isLast && 'border-b border-border/50',
                  props.onRowClick && 'cursor-pointer'
                )}
                onClick={
                  props.onRowClick
                    ? function () {
                        props.onRowClick?.(row)
                      }
                    : undefined
                }>
                {props.columns.map(function (column) {
                  return (
                    <td
                      key={column.key}
                      className={clsx(
                        'h-[var(--backend-row-h)] px-3 align-middle',
                        column.className
                      )}>
                      {column.render(row)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface TableFooterProps {
  count: number
  page: number
  total: number
  isFetching?: boolean
  onPage(page: number): void
}

/** 底栏只做分页；刷新放筛选行 / 页头 actions，避免与翻页挤在一起。 */
function TableFooter(props: TableFooterProps) {
  const lastPage = Math.max(props.total, 1)

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-t border-border/60 bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
      <span>
        共 {props.count} 条 · 第 {props.page}/{lastPage} 页
      </span>
      <div className="ms-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={props.page <= 1 || props.isFetching}
          onClick={function () {
            props.onPage(props.page - 1)
          }}>
          上一页
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={props.page >= lastPage || props.isFetching}
          onClick={function () {
            props.onPage(props.page + 1)
          }}>
          下一页
        </Button>
      </div>
    </div>
  )
}

export { DataTable, TableFooter }
export type { DataTableColumn, DataTableProps, TableFooterProps }
