import { Button } from '@cogito/design/components/button'
import { DatePicker } from '@cogito/design/components/date-picker'
import { Input } from '@cogito/design/components/input'
import { useQuery } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  EXPORT_BILLING_RECONCILIATION,
  GET_BILLING_RECONCILIATION
} from '@/apis/billing.ts'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { FilterBar } from '@/components/console/filter-bar.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { reportCaught } from '@/utils/exception-report.ts'
import { HttpError } from '@/utils/http/errors.ts'

function formatFen(amount: number | undefined | null) {
  if (amount === null || amount === undefined) return '—'
  return (amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function findMilliseconds(value: Dayjs | null) {
  if (!value) return undefined
  const at = value.valueOf()
  return Number.isNaN(at) ? undefined : at
}

export default function ReconciliationView() {
  const [rangeStart, updateRangeStart] = useState<Dayjs | null>(null)
  const [rangeEnd, updateRangeEnd] = useState<Dayjs | null>(null)
  const [tenantFilter, updateTenantFilter] = useState('')
  const [isExporting, updateExporting] = useState(false)

  const query = {
    from: findMilliseconds(rangeStart),
    to: findMilliseconds(rangeEnd),
    tenantID: tenantFilter || undefined
  }

  const report = useQuery({
    queryKey: ['billing-reconciliation', query],
    queryFn: function () {
      return GET_BILLING_RECONCILIATION(query)
    }
  })

  const data = report.data
  const models = data?.models ?? []
  const exceptions = data?.exceptions ?? []
  const totals = data?.totals

  async function handleExport() {
    updateExporting(true)
    try {
      await EXPORT_BILLING_RECONCILIATION({ ...query, format: 'csv' })
      toast.success('已开始下载')
    } catch (error) {
      reportCaught('billing.reconciliation.handleExport', error)
      toast.error(HttpError(error).message)
    } finally {
      updateExporting(false)
    }
  }

  return (
    <ConsolePage
      actions={
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
      }
      toolbar={
        <FilterBar>
          <DatePicker
            className="w-44"
            placeholder="开始时间"
            showTime
            value={rangeStart}
            onChange={function (date) {
              updateRangeStart(date)
            }}
          />
          <DatePicker
            className="w-44"
            placeholder="结束时间"
            showTime
            value={rangeEnd}
            onChange={function (date) {
              updateRangeEnd(date)
            }}
          />
          <Input
            className="max-w-xs"
            placeholder="租户"
            aria-label="租户"
            value={tenantFilter}
            onChange={function (event) {
              updateTenantFilter(event.target.value)
            }}
          />
        </FilterBar>
      }
      bare>
      <QueryState
        isLoading={report.isLoading}
        isError={report.isError}
        error={report.error}
        onRetry={function () {
          void report.refetch()
        }}>
        {totals ? (
          <dl className="mb-6 grid gap-3 sm:grid-cols-3">
            <div
              className="rounded-xl border border-border/80 bg-[var(--backend-surface)] p-3"
              style={{ boxShadow: 'var(--backend-elevation-1)' }}>
              <dt className="text-xs text-muted-foreground">用量金额</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {formatFen(totals.usageAmount)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {data?.currency}
                </span>
              </dd>
            </div>
            <div
              className="rounded-xl border border-border/80 bg-[var(--backend-surface)] p-3"
              style={{ boxShadow: 'var(--backend-elevation-1)' }}>
              <dt className="text-xs text-muted-foreground">实收金额</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {formatFen(totals.orderAmount)}
              </dd>
            </div>
            <div
              className="rounded-xl border border-border/80 bg-[var(--backend-surface)] p-3"
              style={{ boxShadow: 'var(--backend-elevation-1)' }}>
              <dt className="text-xs text-muted-foreground">差额（用量 − 实收）</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{formatFen(totals.delta)}</dd>
            </div>
          </dl>
        ) : null}

        <h2 className="mb-2 text-sm font-medium">型号明细</h2>
        <div
          className="mb-8 overflow-hidden rounded-xl border border-border/80 bg-[var(--backend-surface)]"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          <DataTable
            columns={[
              {
                key: 'tenant',
                title: '租户',
                className: 'font-mono text-xs',
                render(row) {
                  return row.tenantID ?? '—'
                }
              },
              {
                key: 'model',
                title: '模型',
                className: 'font-mono text-xs',
                render(row) {
                  return row.modelName ?? row.modelID
                }
              },
              {
                key: 'requests',
                title: '请求',
                className: 'tabular-nums',
                render(row) {
                  return row.requests
                }
              },
              {
                key: 'tokens',
                title: 'tokens',
                className: 'tabular-nums',
                render(row) {
                  return (row.promptTokens + row.completionTokens).toLocaleString()
                }
              },
              {
                key: 'amount',
                title: '金额',
                className: 'tabular-nums',
                render(row) {
                  return row.mismatchedCurrency ? (
                    <span className="text-muted-foreground">币种不符</span>
                  ) : (
                    formatFen(row.amount)
                  )
                }
              }
            ]}
            rows={models}
            rowKey={function (row) {
              return `${row.tenantID ?? 'p'}-${row.modelID}-${row.priceID ?? 'none'}-${row.requests}`
            }}
            emptyTitle="窗口内无用量明细"
          />
        </div>

        <h2 className="mb-2 text-sm font-medium">异常清单</h2>
        {exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">无异常</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {exceptions.map(function (row, index) {
              return (
                <li
                  key={`${row.kind}-${row.orderNo ?? row.modelID ?? index}`}
                  className="rounded-xl border border-border/80 bg-[var(--backend-surface)] px-3 py-2"
                  style={{ boxShadow: 'var(--backend-elevation-1)' }}>
                  <p className="font-medium">
                    {row.description}{' '}
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {row.kind}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p>
                </li>
              )
            })}
          </ul>
        )}
      </QueryState>
    </ConsolePage>
  )
}
