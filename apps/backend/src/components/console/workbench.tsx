import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { DataTable, type DataTableColumn } from '@/components/console/data-table.tsx'
import { QueryState } from '@/components/console/query-state.tsx'

interface WorkbenchProps<T> {
  query: string
  onQuery(value: string): void
  queryPlaceholder?: string
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey(row: T): string
  isLoading?: boolean
  isError?: boolean
  error?: unknown
  onRetry?(): void
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?(row: T): void
  toolbar?: ReactNode
  footer?: ReactNode
  selected?: ReadonlySet<string>
  onToggle?(id: string): void
  bulk?: ReactNode
}

function Workbench<T>(props: WorkbenchProps<T>) {
  const [hidden, updateHidden] = useState<string[]>([])
  const columns = useMemo(
    function () {
      const visible = props.columns.filter(function (column) {
        return !hidden.includes(column.key)
      })
      if (!props.onToggle) return visible
      const selectColumn: DataTableColumn<T> = {
        key: '__select',
        title: '',
        headerClassName: 'w-10',
        render(row) {
          const id = props.rowKey(row)
          const checked = props.selected?.has(id) ?? false
          return (
            <Checkbox
              checked={checked}
              aria-label="选择行"
              onClick={function (event) {
                event.stopPropagation()
              }}
              onCheckedChange={function () {
                props.onToggle?.(id)
              }}
            />
          )
        }
      }
      return [selectColumn, ...visible]
    },
    [hidden, props]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <Input
          value={props.query}
          placeholder={props.queryPlaceholder ?? '搜索'}
          className="h-9 max-w-sm"
          onChange={function (event) {
            props.onQuery(event.target.value)
          }}
        />
        {props.toolbar}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ms-auto"
              />
            }>
            列
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {props.columns.map(function (column) {
              return (
                <DropdownMenuCheckboxItem
                  key={column.key}
                  checked={!hidden.includes(column.key)}
                  onCheckedChange={function (checked) {
                    updateHidden(function (current) {
                      if (checked) {
                        return current.filter(function (key) {
                          return key !== column.key
                        })
                      }
                      return [...current, column.key]
                    })
                  }}>
                  {column.title}
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {props.bulk ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-sm">
          {props.bulk}
        </div>
      ) : null}
      <QueryState
        isLoading={props.isLoading}
        isError={props.isError}
        error={props.error}
        onRetry={
          props.onRetry
            ? function () {
                props.onRetry?.()
              }
            : undefined
        }>
        <DataTable
          columns={columns}
          rows={props.rows}
          rowKey={function (row) {
            return props.rowKey(row)
          }}
          emptyTitle={props.emptyTitle}
          emptyDescription={props.emptyDescription}
          onRowClick={
            props.onRowClick
              ? function (row) {
                  props.onRowClick?.(row)
                }
              : undefined
          }
        />
      </QueryState>
      {props.footer}
    </div>
  )
}

export { Workbench }
