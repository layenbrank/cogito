import { Input } from '@i-thinking/design/components/input'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { GET_GATEWAY_USAGE } from '@/apis/gateway.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'

export default function UsageView() {
  const [tenantID, updateTenantID] = useState('')
  const [modelID, updateModelID] = useState('')
  const usage = useQuery({
    queryKey: ['gateway-usage', tenantID, modelID],
    queryFn: function () {
      return GET_GATEWAY_USAGE({
        tenantID: tenantID || undefined,
        modelID: modelID || undefined,
        size: 50
      })
    }
  })

  return (
    <div>
      <PageHeader
        title="用量"
        description="跨租户 token 用量抽样。用租户 / 模型 ID 收窄。"
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="tenantID"
          value={tenantID}
          onChange={function (event) {
            updateTenantID(event.target.value)
          }}
        />
        <Input
          className="max-w-xs"
          placeholder="modelID"
          value={modelID}
          onChange={function (event) {
            updateModelID(event.target.value)
          }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="pb-2 font-medium">时间</th>
              <th className="pb-2 font-medium">租户</th>
              <th className="pb-2 font-medium">用户</th>
              <th className="pb-2 font-medium">模型</th>
              <th className="pb-2 font-medium">tokens</th>
              <th className="pb-2 font-medium">延迟</th>
            </tr>
          </thead>
          <tbody>
            {(usage.data ?? []).map(function (row) {
              return (
                <tr
                  key={row.id}
                  className="border-b border-border/70">
                  <td className="py-2 pr-3 text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.tenantID ?? '—'}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.userID}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.modelID}</td>
                  <td className="py-2 pr-3">{row.totalTokens}</td>
                  <td className="py-2">{row.latencyMs}ms</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
