import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { groupBy } from 'lodash-es'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_GATEWAY_ADMIN_MODEL,
  GET_GATEWAY_ADMIN_MODELS,
  GET_GATEWAY_PROVIDERS,
  POST_GATEWAY_ADMIN_MODEL,
  PUT_GATEWAY_ADMIN_MODEL
} from '@/apis/gateway.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
import { HttpError } from '@/utils/http/errors.ts'

export default function ModelsView() {
  const queryClient = useQueryClient()
  const models = useQuery({ queryKey: ['gateway-admin-models'], queryFn: GET_GATEWAY_ADMIN_MODELS })
  const providers = useQuery({ queryKey: ['gateway-providers'], queryFn: GET_GATEWAY_PROVIDERS })
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
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  return (
    <div>
      <PageHeader
        title="平台模型"
        description="按供应商分组。能力与配额在此统一治理。"
      />
      <div className="mb-6 grid gap-3 rounded-xl border border-border/80 p-4 md:grid-cols-5">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={draft.providerID}
          onChange={function (event) {
            updateDraft({ ...draft, providerID: event.target.value })
          }}>
          <option value="">选择供应商</option>
          {(providers.data ?? []).map(function (item) {
            return (
              <option
                key={item.id}
                value={item.id}>
                {item.name}
              </option>
            )
          })}
        </select>
        <Input
          placeholder="name"
          value={draft.name}
          onChange={function (event) {
            updateDraft({ ...draft, name: event.target.value })
          }}
        />
        <Input
          placeholder="label"
          value={draft.label}
          onChange={function (event) {
            updateDraft({ ...draft, label: event.target.value })
          }}
        />
        <Input
          placeholder="日配额 token"
          value={draft.dailyTokenQuota}
          onChange={function (event) {
            updateDraft({ ...draft, dailyTokenQuota: event.target.value })
          }}
        />
        <Button
          onClick={function () {
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
          创建
        </Button>
      </div>

      <div className="space-y-6">
        {Object.entries(grouped).map(function ([providerID, rows]) {
          return (
            <section key={providerID}>
              <h3 className="mb-2 text-sm font-medium">
                {providerName.get(providerID) ?? rows[0]?.providerName ?? providerID}
              </h3>
              <ul className="divide-y divide-border/70 rounded-xl border border-border/80">
                {rows.map(function (model) {
                  return (
                    <li
                      key={model.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium">
                          {model.label}{' '}
                          <span className="font-mono text-xs text-muted-foreground">
                            {model.name}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          配额 {model.dailyTokenQuota || '继承'} ·{' '}
                          {model.enabled ? '已启用' : '已停用'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={function () {
                            toggleModel.mutate({ id: model.id, enabled: !model.enabled })
                          }}>
                          {model.enabled ? '停用' : '启用'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={function () {
                            if (!window.confirm(`删除模型 ${model.label}？`)) return
                            removeModel.mutate(model.id)
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
      </div>
    </div>
  )
}
