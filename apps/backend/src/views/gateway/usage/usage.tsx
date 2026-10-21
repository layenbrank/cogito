import { Input } from '@i-thinking/design/components/input'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { GET_GATEWAY_USAGE } from '@/apis/gateway.ts'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable, TableFooter } from '@/components/console/data-table.tsx'
import { FilterBar } from '@/components/console/filter-bar.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { RefreshButton } from '@/components/console/refresh-button.tsx'

export default function UsageView() {
  const [tenantFilter, updateTenantFilter] = useState('')
  const [modelFilter, updateModelFilter] = useState('')
  const [page, updatePage] = useState(1)
  const size = 50

  const usage = useQuery({
    queryKey: ['gateway-usage', tenantFilter, modelFilter, page],
    queryFn: function () {
      return GET_GATEWAY_USAGE({
        tenantID: tenantFilter || undefined,
        modelID: modelFilter || undefined,
        page,
        size
      })
    }
  })

  const pageData = usage.data

  return (
    <ConsolePage
      toolbar={
        <FilterBar>
          <Input
            className="h-10 max-w-xs"
            placeholder="租户"
            aria-label="租户"
            value={tenantFilter}
            onChange={function (event) {
              updatePage(1)
              updateTenantFilter(event.target.value)
            }}
          />
          <Input
            className="h-10 max-w-xs"
            placeholder="模型"
            aria-label="模型"
            value={modelFilter}
            onChange={function (event) {
              updatePage(1)
              updateModelFilter(event.target.value)
            }}
          />
        </FilterBar>
      }
      actions={
        <RefreshButton
          isFetching={usage.isFetching}
          onRefresh={function () {
            void usage.refetch()
          }}
        />
      }>
      <QueryState
        isLoading={usage.isLoading}
        isError={usage.isError}
        error={usage.error}
        onRetry={function () {
          void usage.refetch()
        }}>
        <DataTable
          columns={[
            {
              key: 'time',
              title: '时间',
              className: 'text-muted-foreground whitespace-nowrap',
              render(row) {
                return new Date(row.createdAt).toLocaleString()
              }
            },
            {
              key: 'tenant',
              title: '租户',
              className: 'font-mono text-xs',
              render(row) {
                if (!row.tenantID) return '—'
                return (
                  <Link
                    to={`/tenants?focus=${row.tenantID}`}
                    className="text-[var(--backend-accent)] hover:underline">
                    {row.tenantID}
                  </Link>
                )
              }
            },
            {
              key: 'user',
              title: '用户',
              className: 'font-mono text-xs',
              render(row) {
                return (
                  <Link
                    to={`/users?focus=${row.userID}`}
                    className="text-[var(--backend-accent)] hover:underline">
                    {row.userID}
                  </Link>
                )
              }
            },
            {
              key: 'model',
              title: '模型',
              className: 'font-mono text-xs',
              render(row) {
                return (
                  <Link
                    to={`/gateway/models?focus=${row.modelID}`}
                    className="text-[var(--backend-accent)] hover:underline">
                    {row.modelID}
                  </Link>
                )
              }
            },
            {
              key: 'tokens',
              title: 'tokens',
              className: 'tabular-nums',
              render(row) {
                return row.totalTokens
              }
            },
            {
              key: 'latency',
              title: '延迟',
              className: 'tabular-nums',
              render(row) {
                return `${row.latencyMs}ms`
              }
            }
          ]}
          rows={pageData?.items ?? []}
          rowKey={function (row) {
            return row.id
          }}
          emptyTitle="窗口内无用量"
        />
        {pageData ? (
          <TableFooter
            count={pageData.count}
            page={pageData.page}
            total={pageData.total}
            isFetching={usage.isFetching}
            onPage={updatePage}
          />
        ) : null}
      </QueryState>
    </ConsolePage>
  )
}
