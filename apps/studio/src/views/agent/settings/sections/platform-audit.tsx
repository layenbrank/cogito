import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { GET_GATEWAY_AUDIT, type GatewayAuditQuery } from '@/apis/gateway.ts'
import { HttpError } from '@/utils/http.errors.ts'
import { formatDateTime } from '@/views/agent/settings/components/format.ts'
import { DataTable, TableFooter, TableLoading } from '@/views/agent/settings/components/table.tsx'

/**
 * 平台 · 审计：谁在什么时候动了目录、调了哪个模型。
 *
 * 只读。`detail` 是服务端存的结构化补充信息，这里压缩成一行 JSON，够查问题即可。
 */

const PAGE_SIZE = 20

function stringifyDetail(detail: unknown): string {
  if (detail === null || detail === undefined) return '—'
  if (typeof detail === 'string') return detail

  try {
    return JSON.stringify(detail)
  } catch (error) {
    console.warn('审计详情序列化失败，退回字符串形式', error)
    return String(detail)
  }
}

function AuditSection() {
  const [tenantID, updateTenantID] = useState('')
  const [pendingTenantID, updatePendingTenantID] = useState('')
  const [page, updatePage] = useState(1)

  const query: GatewayAuditQuery = {
    page,
    size: PAGE_SIZE,
    tenantID: tenantID.trim() || undefined
  }

  const auditQuery = useQuery({
    queryKey: ['gateway', 'audit', query],
    queryFn: function () {
      return GET_GATEWAY_AUDIT(query)
    }
  })

  const pageData = auditQuery.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">审计</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          目录变更与模型调用的流水。只读，按时间倒序。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gateway-audit-tenant">租户 ID</Label>
          <Input
            id="gateway-audit-tenant"
            value={pendingTenantID}
            placeholder="留空 = 全部"
            className="w-64"
            onChange={function (event) {
              updatePendingTenantID(event.target.value)
            }}
          />
        </div>

        <Button
          type="button"
          size="sm"
          onClick={function () {
            updateTenantID(pendingTenantID)
            updatePage(1)
          }}>
          查询
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={function () {
            updatePendingTenantID('')
            updateTenantID('')
            updatePage(1)
          }}>
          重置
        </Button>
      </div>

      {auditQuery.isPending ? (
        <TableLoading />
      ) : auditQuery.isError ? (
        <p className="text-destructive py-6 text-sm">
          {HttpError(auditQuery.error).message || '审计日志加载失败'}
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
                key: 'actor',
                title: '操作者',
                className: 'font-mono text-xs',
                render: function (row) {
                  return <span className="text-muted-foreground">{row.actor}</span>
                }
              },
              {
                key: 'action',
                title: '动作',
                className: 'whitespace-nowrap',
                render: function (row) {
                  return row.action
                }
              },
              {
                key: 'resource',
                title: '资源',
                render: function (row) {
                  return row.resource
                }
              },
              {
                key: 'detail',
                title: '详情',
                className: 'max-w-80 font-mono text-xs',
                render: function (row) {
                  return (
                    <span className="text-muted-foreground block truncate">
                      {stringifyDetail(row.detail)}
                    </span>
                  )
                }
              },
              {
                key: 'ip',
                title: 'IP',
                className: 'whitespace-nowrap font-mono text-xs',
                render: function (row) {
                  return row.ip ?? '—'
                }
              }
            ]}
            rows={pageData?.items ?? []}
            rowKey={function (row) {
              return row.id
            }}
            empty="没有审计记录。"
          />

          {pageData ? (
            <TableFooter
              count={pageData.count}
              page={pageData.page}
              total={pageData.total}
              isFetching={auditQuery.isFetching}
              onPage={updatePage}
              onRefresh={function () {
                void auditQuery.refetch()
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

export { AuditSection }
