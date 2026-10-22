import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { GET_TENANT_MEMBERS, GET_TENANTS } from '@/apis/tenant.ts'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { StatusBadge } from '@/components/console/status-badge.tsx'

export default function TenantsView() {
  const [searchParams] = useSearchParams()
  const focus = searchParams.get('focus')
  const [selectedID, updateSelectedID] = useState<string | null>(null)
  const activeID = focus ?? selectedID
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: GET_TENANTS })
  const members = useQuery({
    queryKey: ['tenant-members', activeID],
    queryFn: function () {
      return GET_TENANT_MEMBERS(activeID!)
    },
    enabled: Boolean(activeID)
  })

  return (
    <ConsolePage bare>
      <div className="grid gap-4 lg:grid-cols-2">
        <div
          className="overflow-hidden rounded-xl border border-border/80 bg-[var(--backend-surface)]"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          <QueryState
            isLoading={tenants.isLoading}
            isError={tenants.isError}
            error={tenants.error}
            onRetry={function () {
              void tenants.refetch()
            }}>
            <DataTable
              columns={[
                {
                  key: 'name',
                  title: '名称',
                  render(row) {
                    return <span className="font-medium">{row.name}</span>
                  }
                },
                {
                  key: 'kind',
                  title: '类型',
                  className: 'text-muted-foreground',
                  render(row) {
                    return row.kind
                  }
                },
                {
                  key: 'status',
                  title: '状态',
                  render(row) {
                    return <StatusBadge status={row.status} />
                  }
                }
              ]}
              rows={tenants.data ?? []}
              rowKey={function (row) {
                return row.id
              }}
              emptyTitle="暂无租户"
              onRowClick={function (row) {
                updateSelectedID(row.id)
              }}
            />
          </QueryState>
        </div>
        <div
          className="rounded-xl border border-border/80 bg-[var(--backend-surface)] p-4"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          <h3 className="mb-3 text-sm font-medium">成员</h3>
          {!activeID ? (
            <p className="text-sm text-muted-foreground">选择左侧租户</p>
          ) : (
            <QueryState
              isLoading={members.isLoading}
              isError={members.isError}
              error={members.error}
              skeletonRows={4}
              onRetry={function () {
                void members.refetch()
              }}>
              <DataTable
                columns={[
                  {
                    key: 'user',
                    title: '用户',
                    className: 'font-mono text-xs',
                    render(row) {
                      return row.username ?? row.userID
                    }
                  },
                  {
                    key: 'role',
                    title: '角色',
                    render(row) {
                      return row.role
                    }
                  },
                  {
                    key: 'status',
                    title: '状态',
                    render(row) {
                      return <StatusBadge status={row.status} />
                    }
                  }
                ]}
                rows={members.data ?? []}
                rowKey={function (row) {
                  return row.userID
                }}
                emptyTitle="无成员"
              />
            </QueryState>
          )}
        </div>
      </div>
    </ConsolePage>
  )
}
