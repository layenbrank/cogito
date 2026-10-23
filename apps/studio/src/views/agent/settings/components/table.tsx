import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * 设置页里只读列表的排版基元：表格 + 分页脚。
 *
 * 管理面（供应商 / 模型 / 用量 / 审计）都是「一行一条记录，右侧操作」，
 * 各写各的表格很快就会在列宽与边框上歪掉，所以抽出来统一。
 */

interface TableColumn<T> {
  key: string
  title: string
  render(row: T): ReactNode
  className?: string
}

function DataTable<T>(props: {
  columns: TableColumn<T>[]
  rows: T[]
  rowKey(row: T): string
  empty: string
}) {
  if (props.rows.length === 0) {
    return <p className="text-muted-foreground py-6 text-sm">{props.empty}</p>
  }

  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/40">
            {props.columns.map(function (column) {
              return (
                <th
                  key={column.key}
                  className={cn(
                    'text-muted-foreground px-3 py-2 text-start text-xs font-medium whitespace-nowrap',
                    column.className
                  )}>
                  {column.title}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {props.rows.map(function (row) {
            return (
              <tr
                key={props.rowKey(row)}
                className="border-border border-t">
                {props.columns.map(function (column) {
                  return (
                    <td
                      key={column.key}
                      className={cn('px-3 py-2 align-middle', column.className)}>
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

/** 分页脚：服务端的 `page` 从 1 起，`total` 是总页数 */
function TableFooter(props: {
  count: number
  page: number
  total: number
  isFetching?: boolean
  onPage(page: number): void
  onRefresh?(): void
}) {
  const lastPage = Math.max(props.total, 1)

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <span>
        共 {props.count} 条 · 第 {props.page}/{lastPage} 页
      </span>

      {props.onRefresh ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.isFetching}
          onClick={props.onRefresh}>
          <Icon icon="lucide:refresh-cw" className={cn(props.isFetching && 'animate-spin')} />
          刷新
        </Button>
      ) : null}

      <div className="ms-auto flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.page <= 1 || props.isFetching}
          onClick={function () {
            props.onPage(props.page - 1)
          }}>
          <Icon icon="lucide:chevron-left" />
          上一页
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.page >= lastPage || props.isFetching}
          onClick={function () {
            props.onPage(props.page + 1)
          }}>
          下一页
          <Icon icon="lucide:chevron-right" />
        </Button>
      </div>
    </div>
  )
}

function TableLoading(props: { label?: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
      <Spinner className="size-4" />
      {props.label ?? '加载中…'}
    </p>
  )
}

export { DataTable, TableFooter, TableLoading }
export type { TableColumn }
