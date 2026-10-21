import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { groupBy } from 'lodash-es'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  DELETE_GATEWAY_ADMIN_MODEL,
  GET_GATEWAY_ADMIN_MODELS,
  GET_GATEWAY_PROVIDERS,
  POST_GATEWAY_ADMIN_MODEL,
  PUT_GATEWAY_ADMIN_MODEL,
  type GatewayModel
} from '@/apis/gateway.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { HttpError } from '@/utils/http/errors.ts'

export default function ModelsView() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const focusID = searchParams.get('focus')
  const models = useQuery({ queryKey: ['gateway-admin-models'], queryFn: GET_GATEWAY_ADMIN_MODELS })
  const providers = useQuery({ queryKey: ['gateway-providers'], queryFn: GET_GATEWAY_PROVIDERS })
  const [sheetOpen, updateSheetOpen] = useState(false)
  const [pendingDelete, updatePendingDelete] = useState<GatewayModel | null>(null)
  const [draft, updateDraft] = useState({
    providerID: '',
    name: '',
    label: '',
    dailyTokenQuota: '0'
  })

  const grouped = useMemo(
    function () {
      return groupBy(models.data ?? [], 'providerID')
    },
    [models.data]
  )

  const providerName = useMemo(
    function () {
      return new Map(
        (providers.data ?? []).map(function (item) {
          return [item.id, item.name]
        })
      )
    },
    [providers.data]
  )

  const createModel = useMutation({
    mutationFn: POST_GATEWAY_ADMIN_MODEL,
    onSuccess() {
      toast.success('已创建模型')
      void queryClient.invalidateQueries({ queryKey: ['gateway-admin-models'] })
      updateSheetOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const toggleModel = useMutation({
    mutationFn: function (input: { id: string; enabled: boolean }) {
      return PUT_GATEWAY_ADMIN_MODEL(input.id, { enabled: input.enabled })
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ['gateway-admin-models'] })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const removeModel = useMutation({
    mutationFn: DELETE_GATEWAY_ADMIN_MODEL,
    onSuccess() {
      toast.success('已删除')
      void queryClient.invalidateQueries({ queryKey: ['gateway-admin-models'] })
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
          新建模型
        </Button>
      }
      bare>
      <QueryState
        isLoading={models.isLoading}
        isError={models.isError}
        error={models.error}
        onRetry={function () {
          void models.refetch()
        }}>
        <div className="space-y-4">
          {Object.entries(grouped).map(function ([providerID, rows]) {
            return (
              <section
                key={providerID}
                className="overflow-hidden rounded-xl border border-border/80 bg-[var(--backend-surface)]"
                style={{ boxShadow: 'var(--backend-elevation-1)' }}>
                <h3 className="border-b border-border/60 bg-muted/30 px-4 py-2.5 text-sm font-medium">
                  {providerName.get(providerID) ?? rows[0]?.providerName ?? providerID}
                </h3>
                <ul className="divide-y divide-border/60">
                  {rows.map(function (model) {
                    return (
                      <li
                        key={model.id}
                        className={[
                          'flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm',
                          model.id === focusID ? 'bg-[var(--backend-accent-soft)]' : ''
                        ].join(' ')}>
                        <div>
                          <p className="font-medium">
                            {model.label}{' '}
                            <span className="font-mono text-xs text-muted-foreground">
                              {model.name}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            配额 {model.dailyTokenQuota || '继承'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={model.enabled ? 'success' : 'secondary'}>
                            {model.enabled ? '已启用' : '已停用'}
                          </Badge>
                          <Button
                            variant="outline"
                            onClick={function () {
                              toggleModel.mutate({ id: model.id, enabled: !model.enabled })
                            }}>
                            {model.enabled ? '停用' : '启用'}
                          </Button>
                          <Button
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={function () {
                              updatePendingDelete(model)
                            }}>
                            删除
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
          {!models.isLoading && Object.keys(grouped).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">暂无模型</p>
          ) : null}
        </div>
      </QueryState>

      <EntitySheet
        open={sheetOpen}
        title="新建模型"
        submitLabel="创建"
        isPending={createModel.isPending}
        onOpenChange={updateSheetOpen}
        onSubmit={function () {
          if (!draft.providerID || !draft.name || !draft.label) {
            toast.error('填写供应商、name、label')
            return
          }
          createModel.mutate({
            providerID: draft.providerID,
            name: draft.name,
            label: draft.label,
            dailyTokenQuota: Number(draft.dailyTokenQuota) || 0
          })
        }}>
        <div className="space-y-2">
          <Label>供应商</Label>
          <Select
            items={(providers.data ?? []).map(function (item) {
              return { value: item.id, label: item.name }
            })}
            value={draft.providerID || null}
            onValueChange={function (value) {
              if (value) updateDraft({ ...draft, providerID: value })
            }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择供应商" />
            </SelectTrigger>
            <SelectContent>
              {(providers.data ?? []).map(function (item) {
                return (
                  <SelectItem
                    key={item.id}
                    value={item.id}>
                    {item.name}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>名称</Label>
          <Input
            placeholder="模型名称"
            value={draft.name}
            onChange={function (event) {
              updateDraft({ ...draft, name: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>显示名</Label>
          <Input
            placeholder="对外展示标签"
            value={draft.label}
            onChange={function (event) {
              updateDraft({ ...draft, label: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>日配额（token）</Label>
          <Input
            value={draft.dailyTokenQuota}
            onChange={function (event) {
              updateDraft({ ...draft, dailyTokenQuota: event.target.value })
            }}
          />
        </div>
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`删除模型 ${pendingDelete?.label ?? ''}？`}
        description="删除后客户端目录将不再展示该模型。"
        confirmLabel="删除"
        destructive
        isPending={removeModel.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingDelete(null)
        }}
        onConfirm={function () {
          if (pendingDelete) removeModel.mutate(pendingDelete.id)
        }}
      />
    </ConsolePage>
  )
}
