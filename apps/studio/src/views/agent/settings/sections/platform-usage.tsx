import { Button } from '@i-thinking/design/components/button'
import { DatePicker } from '@i-thinking/design/components/date-picker'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { useQuery } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import { useState } from 'react'

import {
  GET_GATEWAY_ADMIN_MODELS,
  GET_GATEWAY_USAGE,
  type GatewayUsageQuery
} from '@/apis/gateway.ts'
import { HttpError } from '@/utils/http.errors.ts'
import { formatDateTime } from '@/views/agent/settings/components/format.ts'
import { DataTable, TableFooter, TableLoading } from '@/views/agent/settings/components/table.tsx'

/**
 * 平台 · 用量：每次补全落一条，是计费与排障的原始账单。
 *
 * 时间筛选用 DatePicker.showTime（本地时间），转成毫秒再发；服务端按闭区间过滤。
 */

const PAGE_SIZE = 20
const ALL = 'all'

interface UsageFilter {
  tenantID: string
  modelID: string
  /** 空表示不筛 */
  from: Dayjs | null
  to: Dayjs | null
}

function emptyFilter(): UsageFilter {
  return { tenantID: '', modelID: ALL, from: null, to: null }
}

function findMilliseconds(value: Dayjs | null): number | undefined {
  if (!value) return undefined
  const at = value.valueOf()
  return Number.isNaN(at) ? undefined : at
}

function UsageSection() {
  const [filter, updateFilter] = useState<UsageFilter>(emptyFilter)
  const [page, updatePage] = useState(1)

  // 待提交的输入：点「查询」才落进 filter，免得每敲一个字就打一次接口
  const [pending, updatePending] = useState<UsageFilter>(emptyFilter)

  const modelsQuery = useQuery({
    queryKey: ['gateway', 'admin-models'],
    queryFn: function () {
      return GET_GATEWAY_ADMIN_MODELS()
    }
  })

  const query: GatewayUsageQuery = {
    page,
    size: PAGE_SIZE,
    tenantID: filter.tenantID.trim() || undefined,
    modelID: filter.modelID === ALL ? undefined : filter.modelID,
    from: findMilliseconds(filter.from),
    to: findMilliseconds(filter.to)
  }

  const usageQuery = useQuery({
    queryKey: ['gateway', 'usage', query],
    queryFn: function () {
      return GET_GATEWAY_USAGE(query)
    }
  })

  const models = modelsQuery.data ?? []
  const pageData = usageQuery.data

  function findModelLabel(id: string): string {
    const model = models.find(function (item) {
      return item.id === id
    })
    return model ? model.label : id
  }

  function submit() {
    updateFilter(pending)
    updatePage(1)
  }

  function reset() {
    updatePending(emptyFilter())
    updateFilter(emptyFilter())
    updatePage(1)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">用量</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          每次补全一条记录，含 token 计数与上游耗时。用来核对配额、排查超时。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gateway-usage-model">模型</Label>
          <Select
            items={[{ value: ALL, label: '全部模型' }].concat(
              models.map(function (model) {
                return { value: model.id, label: model.label }
              })
            )}
            value={pending.modelID}
            onValueChange={function (value) {
              if (value === null) return
              updatePending({ ...pending, modelID: value })
            }}>
            <SelectTrigger
              id="gateway-usage-model"
              className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部模型</SelectItem>
              {models.map(function (model) {
                return (
                  <SelectItem
                    key={model.id}
                    value={model.id}>
                    {model.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gateway-usage-tenant">租户 ID</Label>
          <Input
            id="gateway-usage-tenant"
            value={pending.tenantID}
            placeholder="留空 = 全部"
            className="w-64"
            onChange={function (event) {
              updatePending({ ...pending, tenantID: event.target.value })
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gateway-usage-from">开始</Label>
          <DatePicker
            id="gateway-usage-from"
            showTime
            value={pending.from}
            className="w-52"
            onChange={function (date) {
              updatePending({ ...pending, from: date })
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gateway-usage-to">结束</Label>
          <DatePicker
            id="gateway-usage-to"
            showTime
            value={pending.to}
            className="w-52"
            onChange={function (date) {
              updatePending({ ...pending, to: date })
            }}
          />
        </div>

        <Button
          type="button"
          size="sm"
          onClick={submit}>
          查询
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={reset}>
          重置
        </Button>
      </div>

      {usageQuery.isPending ? (
        <TableLoading />
      ) : usageQuery.isError ? (
        <p className="text-destructive py-6 text-sm">
          {HttpError(usageQuery.error).message || '用量加载失败'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <DataTable
            columns={[
              {
                key: 'createdAt',
                title: '时间',
                className: 'whitespace-nowrap text-xs',
                render: function (row) {
                  return formatDateTime(row.createdAt)
                }
              },
              {
                key: 'modelID',
                title: '模型',
                render: function (row) {
                  return findModelLabel(row.modelID)
                }
              },
              {
                key: 'userID',
                title: '用户',
                className: 'font-mono text-xs',
                render: function (row) {
                  return <span className="text-muted-foreground">{row.userID}</span>
                }
              },
              {
                key: 'tenantID',
                title: '租户',
                className: 'font-mono text-xs',
                render: function (row) {
                  return <span className="text-muted-foreground">{row.tenantID ?? '—'}</span>
                }
              },
              {
                key: 'tokens',
                title: 'Prompt / 补全 / 合计',
                className: 'whitespace-nowrap',
                render: function (row) {
                  return `${row.promptTokens} / ${row.completionTokens} / ${row.totalTokens}`
                }
              },
              {
                key: 'latencyMs',
                title: '耗时',
                className: 'whitespace-nowrap',
                render: function (row) {
                  return `${row.latencyMs} ms`
                }
              },
              {
                key: 'status',
                title: '状态',
                render: function (row) {
                  return row.status
                }
              }
            ]}
            rows={pageData?.items ?? []}
            rowKey={function (row) {
              return row.id
            }}
            empty="这段时间没有用量记录。"
          />

          {pageData ? (
            <TableFooter
              count={pageData.count}
              page={pageData.page}
              total={pageData.total}
              isFetching={usageQuery.isFetching}
              onPage={updatePage}
              onRefresh={function () {
                void usageQuery.refetch()
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

export { UsageSection }
