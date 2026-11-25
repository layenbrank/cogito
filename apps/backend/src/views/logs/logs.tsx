import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { EXPORT_GATEWAY_AUDIT, GET_GATEWAY_AUDIT } from '@/apis/gateway.ts'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable, TableFooter } from '@/components/console/data-table.tsx'
import { formatFieldValue } from '@/components/console/field-label.ts'
import { FilterBar } from '@/components/console/filter-bar.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { RefreshButton } from '@/components/console/refresh-button.tsx'
import { reportCaught } from '@/utils/exception-report.ts'
import { HttpError } from '@/utils/http/errors.ts'

function formatAuditDetail(detail: unknown) {
  if (detail === null || detail === undefined || detail === '') return '—'
  if (typeof detail === 'string') return detail
  if (typeof detail === 'object' && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>
    const parts: string[] = []
    if (record.status !== null && record.status !== undefined) {
      parts.push(formatFieldValue(record.status))
    }
    if (typeof record.totalTokens === 'number') {
      parts.push(`${record.totalTokens.toLocaleString()} tokens`)
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === 'status' || key === 'totalTokens') continue
      parts.push(`${key} ${formatFieldValue(value)}`)
    }
    if (parts.length > 0) return parts.join(' · ')
  }
  return formatFieldValue(detail)
}

/** 平台操作日志：对接 cogito `GET /gateway/audit` */
export default function LogsView() {
  const [action, updateAction] = useState('')
  const [page, updatePage] = useState(1)
  const [isExporting, updateExporting] = useState(false)
  const size = 50

  const audit = useQuery({
    queryKey: ['gateway-audit', action, page],
    queryFn: function () {
      return GET_GATEWAY_AUDIT({ action: action || undefined, page, size })
    }
  })

  const pageData = audit.data

  async function handleExport() {
    updateExporting(true)
    try {
      await EXPORT_GATEWAY_AUDIT({ action: action || undefined, format: 'csv' })
      toast.success('已开始下载')
    } catch (error) {
      reportCaught('logs.handleExport', error)
      toast.error(HttpError(error).message)
    } finally {
      updateExporting(false)
    }
  }

  return (
    <ConsolePage
      actions={
        <>
          <RefreshButton
            isFetching={audit.isFetching}
            onRefresh={function () {
              void audit.refetch()
            }}
          />
          <Button
            size="lg"
            variant="outline"
            className="h-10 px-4"
            disabled={isExporting}
            onClick={function () {
              void handleExport()
            }}>
            导出 CSV
          </Button>
        </>
      }
      toolbar={
        <FilterBar>
          <Input
            className="h-10 max-w-sm"
            placeholder="操作类型"
            aria-label="操作类型"
            value={action}
            onChange={function (event) {
              updatePage(1)
              updateAction(event.target.value)
            }}
          />
        </FilterBar>
      }>
      <QueryState
        isLoading={audit.isLoading}
        isError={audit.isError}
        error={audit.error}
        onRetry={function () {
          void audit.refetch()
        }}>
        <DataTable
          columns={[
            {
              key: 'time',
              title: '时间',
              className: 'whitespace-nowrap text-muted-foreground',
              render(row) {
                return new Date(row.createdAt).toLocaleString()
              }
            },
            {
              key: 'action',
              title: '动作',
              render(row) {
                return (
                  <span>
                    <span className="font-medium">{row.action}</span>{' '}
                    <span className="text-muted-foreground">{row.resource}</span>
                  </span>
                )
              }
            },
            {
              key: 'actor',
              title: '主体',
              className: 'font-mono text-xs',
              render(row) {
                return row.actor
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
                    className="text-primary hover:underline">
                    {row.tenantID}
                  </Link>
                )
              }
            },
            {
              key: 'detail',
              title: '详情',
              className: 'max-w-xs truncate text-xs text-muted-foreground',
              render(row) {
                return formatAuditDetail(row.detail)
              }
            }
          ]}
          rows={pageData?.items ?? []}
          rowKey={function (row) {
            return row.id
          }}
          emptyTitle="暂无日志"
        />
        {pageData ? (
          <TableFooter
            count={pageData.count}
            page={pageData.page}
            total={pageData.total}
            isFetching={audit.isFetching}
            onPage={updatePage}
          />
        ) : null}
      </QueryState>
    </ConsolePage>
  )
}
