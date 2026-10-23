import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_BILLING_PRICE,
  GET_BILLING_PRICES,
  POST_BILLING_PRICE,
  type BillingPrice
} from '@/apis/billing.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { HttpError } from '@/utils/http/errors.ts'

export default function PricesView() {
  const queryClient = useQueryClient()
  const prices = useQuery({ queryKey: ['billing-prices'], queryFn: GET_BILLING_PRICES })
  const [sheetOpen, updateSheetOpen] = useState(false)
  const [pendingDelete, updatePendingDelete] = useState<BillingPrice | null>(null)
  const [draft, updateDraft] = useState({
    modelID: '',
    tenantID: '',
    currency: 'CNY',
    inputPerMTok: '',
    outputPerMTok: ''
  })

  const createPrice = useMutation({
    mutationFn: POST_BILLING_PRICE,
    onSuccess() {
      toast.success('已创建价目')
      void queryClient.invalidateQueries({ queryKey: ['billing-prices'] })
      updateSheetOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const removePrice = useMutation({
    mutationFn: DELETE_BILLING_PRICE,
    onSuccess() {
      toast.success('已归档/删除价目')
      void queryClient.invalidateQueries({ queryKey: ['billing-prices'] })
      updatePendingDelete(null)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  return (
    <ConsolePage
      actions={
        <Button
          size="lg"
          className="h-10 px-4"
          onClick={function () {
            updateSheetOpen(true)
          }}>
          新建价目
        </Button>
      }>
      <QueryState
        isLoading={prices.isLoading}
        isError={prices.isError}
        error={prices.error}
        onRetry={function () {
          void prices.refetch()
        }}>
        <DataTable
          columns={[
            {
              key: 'model',
              title: '模型',
              render(row) {
                return row.modelName ?? row.modelID
              }
            },
            {
              key: 'tenant',
              title: '范围',
              render(row) {
                return row.tenantID ? (
                  <span className="font-mono text-xs">{row.tenantID}</span>
                ) : (
                  <Badge variant="secondary">平台默认</Badge>
                )
              }
            },
            {
              key: 'input',
              title: '输入',
              className: 'tabular-nums',
              render(row) {
                return row.inputPerMTok
              }
            },
            {
              key: 'output',
              title: '输出',
              className: 'tabular-nums',
              render(row) {
                return row.outputPerMTok
              }
            },
            {
              key: 'currency',
              title: '币种',
              render(row) {
                return row.currency
              }
            },
            {
              key: 'actions',
              title: '操作',
              headerClassName: 'text-right',
              className: 'text-right',
              render(row) {
                return (
                  <Button
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={function () {
                      updatePendingDelete(row)
                    }}>
                    删除
                  </Button>
                )
              }
            }
          ]}
          rows={prices.data ?? []}
          rowKey={function (row) {
            return row.id
          }}
          emptyTitle="暂无价目"
          emptyActionLabel="新建价目"
          onEmptyAction={function () {
            updateSheetOpen(true)
          }}
        />
      </QueryState>

      <EntitySheet
        open={sheetOpen}
        title="新建价目"
        description="新开一条生效窗口，不原地改价。"
        submitLabel="创建"
        isPending={createPrice.isPending}
        onOpenChange={updateSheetOpen}
        onSubmit={function () {
          if (!draft.modelID || !draft.inputPerMTok || !draft.outputPerMTok) {
            toast.error('填写模型与单价')
            return
          }
          createPrice.mutate({
            modelID: draft.modelID,
            tenantID: draft.tenantID || null,
            currency: draft.currency,
            inputPerMTok: Number(draft.inputPerMTok),
            outputPerMTok: Number(draft.outputPerMTok)
          })
        }}>
        <div className="space-y-2">
          <Label>模型</Label>
          <Input
            placeholder="选择或填写模型标识"
            value={draft.modelID}
            onChange={function (event) {
              updateDraft({ ...draft, modelID: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>租户（留空 = 平台默认）</Label>
          <Input
            placeholder="可选"
            value={draft.tenantID}
            onChange={function (event) {
              updateDraft({ ...draft, tenantID: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>币种</Label>
          <Input
            value={draft.currency}
            onChange={function (event) {
              updateDraft({ ...draft, currency: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>输入 / 百万 token</Label>
          <Input
            value={draft.inputPerMTok}
            onChange={function (event) {
              updateDraft({ ...draft, inputPerMTok: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>输出 / 百万 token</Label>
          <Input
            value={draft.outputPerMTok}
            onChange={function (event) {
              updateDraft({ ...draft, outputPerMTok: event.target.value })
            }}
          />
        </div>
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除该价目？"
        description="软归档后不再参与取价；历史对账仍可追溯。"
        confirmLabel="删除"
        destructive
        isPending={removePrice.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingDelete(null)
        }}
        onConfirm={function () {
          if (pendingDelete) removePrice.mutate(pendingDelete.id)
        }}
      />
    </ConsolePage>
  )
}
