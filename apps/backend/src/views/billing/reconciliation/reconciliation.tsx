import { useQuery } from '@tanstack/react-query'

import { GET_BILLING_RECONCILIATION } from '@/apis/billing.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'

export default function ReconciliationView() {
  const report = useQuery({
    queryKey: ['billing-reconciliation'],
    queryFn: function () {
      return GET_BILLING_RECONCILIATION({})
    }
  })

  return (
    <div>
      <PageHeader
        title="对账"
        description="用量 × 价目的运维汇总。"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="pb-2 font-medium">租户</th>
              <th className="pb-2 font-medium">模型</th>
              <th className="pb-2 font-medium">tokens</th>
              <th className="pb-2 font-medium">金额</th>
            </tr>
          </thead>
          <tbody>
            {(report.data ?? []).map(function (row, index) {
              return (
                <tr
                  key={`${row.tenantID ?? 'p'}-${row.modelID}-${index}`}
                  className="border-b border-border/70">
                  <td className="py-2.5 pr-3 font-mono text-xs">{row.tenantID ?? '—'}</td>
                  <td className="py-2.5 pr-3 font-mono text-xs">{row.modelID}</td>
                  <td className="py-2.5 pr-3">{row.totalTokens}</td>
                  <td className="py-2.5">{row.amount}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
