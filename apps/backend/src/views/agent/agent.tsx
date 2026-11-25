import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { GET_AGENT_TASKS, type AgentTask } from '@/apis/agent.ts'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { EntityLink } from '@/components/console/entity-link.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { StatusBadge } from '@/components/console/status-badge.tsx'
import { useQueryText } from '@/components/console/use-query-text.ts'
import { findFieldLabel, formatFieldValue } from '@/components/console/field-label.ts'

function textOf(task: AgentTask, key: string) {
  const value = task[key]
  return typeof value === 'string' ? value : ''
}

export default function AgentView() {
  const { query, writeQuery } = useQueryText()
  const [picked, updatePicked] = useState<AgentTask | null>(null)
  const tasks = useQuery({
    queryKey: ['admin-agent-tasks'],
    queryFn: function () {
      return GET_AGENT_TASKS()
    }
  })
  const needle = query.trim().toLowerCase()
  const rows = (tasks.data ?? []).filter(function (task) {
    if (!needle) return true
    return (
      task.id.toLowerCase().includes(needle) ||
      textOf(task, 'objective').toLowerCase().includes(needle) ||
      textOf(task, 'tenantID').toLowerCase().includes(needle) ||
      task.status.toLowerCase().includes(needle)
    )
  })

  return (
    <ConsolePage
      toolbar={
        <Input
          value={query}
          placeholder="搜索任务 / 目标 / 租户"
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
              key: 'objective',
              title: '目标',
              render(row) {
                return textOf(row, 'objective') || row.id
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
                return <EntityLink to={`/tenants?focus=${tenantID}`}>{tenantID.slice(0, 8)}</EntityLink>
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
          emptyTitle="没有任务"
        />
      </QueryState>
      {picked ? (
        <div className="border-t border-border p-4 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">{picked.id}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={function () {
                updatePicked(null)
              }}>
              关闭
            </Button>
          </div>
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
