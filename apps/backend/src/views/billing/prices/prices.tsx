import { Button } from '@i-thinking/design/components/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { DELETE_BILLING_PRICE, GET_BILLING_PRICES } from '@/apis/billing.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
import { HttpError } from '@/utils/http/errors.ts'

export default function PricesView() {
  const queryClient = useQueryClient()
  const prices = useQuery({ queryKey: ['billing-prices'], queryFn: GET_BILLING_PRICES })
  const removePrice = useMutation({
    mutationFn: DELETE_BILLING_PRICE,
    onSuccess() {
      toast.success('已归档/删除价目')
      void queryClient.invalidateQueries({ queryKey: ['billing-prices'] })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  return (
    <div>
      <PageHeader
        title="价目"
        description="平台默认价与租户专属价。金额口径为每百万 token。"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="pb-2 font-medium">模型</th>
              <th className="pb-2 font-medium">租户</th>
              <th className="pb-2 font-medium">输入</th>
              <th className="pb-2 font-medium">输出</th>
              <th className="pb-2 font-medium">币种</th>
              <th className="pb-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {(prices.data ?? []).map(function (row) {
              return (
                <tr
                  key={row.id}
                  className="border-b border-border/70">
                  <td className="py-2.5 pr-3">{row.modelName ?? row.modelID}</td>
                  <td className="py-2.5 pr-3 font-mono text-xs">{row.tenantID ?? '平台默认'}</td>
                  <td className="py-2.5 pr-3">{row.inputPerMTok}</td>
                  <td className="py-2.5 pr-3">{row.outputPerMTok}</td>
                  <td className="py-2.5 pr-3">{row.currency}</td>
                  <td className="py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={function () {
                        if (!window.confirm('删除该价目？')) return
                        removePrice.mutate(row.id)
                      }}>
                      删除
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
