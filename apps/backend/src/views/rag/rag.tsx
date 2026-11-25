import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { GET_RAG_INDEX_TASKS, type RagIndexTask } from '@/apis/rag.ts'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { EntityLink } from '@/components/console/entity-link.tsx'
import { findFieldLabel, formatFieldValue } from '@/components/console/field-label.ts'
import { QueryState } from '@/components/console/query-state.tsx'
import { StatusBadge } from '@/components/console/status-badge.tsx'
import { useQueryText } from '@/components/console/use-query-text.ts'

function textOf(task: RagIndexTask, key: string) {
  const value = task[key]
  return typeof value === 'string' ? value : ''
}

export default function RagView() {
  const { query, writeQuery } = useQueryText()
  const [picked, updatePicked] = useState<RagIndexTask | null>(null)
  const tasks = useQuery({
    queryKey: ['admin-rag-tasks'],
    queryFn: function () {
      return GET_RAG_INDEX_TASKS()
    }
  })
  const needle = query.trim().toLowerCase()
  const rows = (tasks.data ?? []).filter(function (task) {
    if (!needle) return true
    return (
      task.id.toLowerCase().includes(needle) ||
      textOf(task, 'assetID').toLowerCase().includes(needle) ||
      textOf(task, 'tenantID').toLowerCase().includes(needle) ||
      task.status.toLowerCase().includes(needle)
    )
  })

  return (
    <ConsolePage
      toolbar={
        <Input
          value={query}
          placeholder="搜索任务 / 资产 / 租户"
          className="h-9 max-w-sm"
          onChange={function (event) {
            writeQuery(event.target.value)
          }}
        />
      }>
      <QueryState
        isLoading={tasks.isLoading}
        isError={tasks.isError}
        error={tasks.error}
        onRetry={function () {
          void tasks.refetch()
        }}>
        <DataTable
          columns={[
            {
              key: 'asset',
              title: '资产',
              render(row) {
                return textOf(row, 'assetID') || row.id
              }
            },
            {
              key: 'status',
              title: '状态',
              render(row) {
                return <StatusBadge status={row.status} />
              }
            },
            {
              key: 'tenant',
              title: '租户',
              render(row) {
                const tenantID = textOf(row, 'tenantID')
                if (!tenantID) return '—'
                return (
                  <EntityLink to={`/tenants?focus=${tenantID}`}>{tenantID.slice(0, 8)}</EntityLink>
                )
              }
            },
            {
              key: 'open',
              title: '',
              className: 'text-right',
              render(row) {
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={function () {
                      updatePicked(row)
                    }}>
                    详情
                  </Button>
                )
              }
            }
          ]}
          rows={rows}
          rowKey={function (row) {
            return row.id
          }}
          emptyTitle="没有索引任务"
        />
      </QueryState>
      {picked ? (
        <div className="border-t border-border p-4 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(picked).map(function ([key, value]) {
              return (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{findFieldLabel(key)}</dt>
                  <dd className="break-all">{formatFieldValue(value)}</dd>
                </div>
              )
            })}
          </dl>
        </div>
      ) : null}
    </ConsolePage>
  )
}
