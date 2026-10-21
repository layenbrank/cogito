import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import {
  NativeSelect,
  NativeSelectOption
} from '@i-thinking/design/components/native-select'
import { Switch } from '@i-thinking/design/components/switch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { groupBy } from 'lodash-es'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_GATEWAY_ADMIN_MODEL,
  GATEWAY_MODEL_ROLES,
  GET_GATEWAY_ADMIN_MODELS,
  GET_GATEWAY_PROVIDERS,
  POST_GATEWAY_ADMIN_MODEL,
  PUT_GATEWAY_ADMIN_MODEL
} from '@/apis/gateway.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
import { HttpError } from '@/utils/http/errors.ts'

interface ModelDraft {
  providerID: string
  name: string
  label: string
  allowRoles: string[]
  enabled: boolean
  dailyTokenQuota: string
  tools: boolean
  reasoning: boolean
  vision: boolean
  contextWindow: string
}

function emptyDraft(providerID: string): ModelDraft {
  return {
    providerID,
    name: '',
    label: '',
    allowRoles: [],
    enabled: true,
    dailyTokenQuota: '0',
    tools: true,
    reasoning: false,
    vision: false,
    contextWindow: ''
  }
}

function parseWindow(raw: string): number | undefined {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

function formatRoles(roles: string[] | null | undefined): string {
  if (!roles || roles.length === 0) return '全部'
  return roles.join('、')
}

function formatCapabilities(model: {
  capabilities?: Record<string, unknown> | null
}): string {
  const capabilities = model.capabilities ?? {}
  const tags = [capabilities.tools === false ? '仅聊天' : '工具']
  if (capabilities.reasoning) tags.push('推理')
  if (capabilities.vision) tags.push('视觉')
  return tags.join(' · ')
}

export default function ModelsView() {
  const queryClient = useQueryClient()
  const models = useQuery({ queryKey: ['gateway-admin-models'], queryFn: GET_GATEWAY_ADMIN_MODELS })
  const providers = useQuery({ queryKey: ['gateway-providers'], queryFn: GET_GATEWAY_PROVIDERS })
  const [draft, updateDraft] = useState<ModelDraft>(function () {
    return emptyDraft('')
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
      updateDraft(emptyDraft(draft.providerID))
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

  const firstProviderID = providers.data?.[0]?.id ?? ''
  const activeProviderID = draft.providerID || firstProviderID

  function toggleRole(role: string) {
    updateDraft(function (prev) {
      const hasRole = prev.allowRoles.includes(role)
      return {
        ...prev,
        allowRoles: hasRole
          ? prev.allowRoles.filter(function (item) {
              return item !== role
            })
          : [...prev.allowRoles, role]
      }
    })
  }

  return (
    <div>
      <PageHeader
        title="平台模型"
        description="按供应商分组。能力、可见角色与配额在此统一治理；客户端目录只展示已启用且角色匹配的条目。"
      />
      <div className="mb-6 space-y-4 rounded-xl border border-border/80 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <NativeSelect
            className="w-full"
            aria-label="供应商"
            value={activeProviderID}
            onChange={function (event) {
              updateDraft({ ...draft, providerID: event.target.value })
            }}>
            <NativeSelectOption value="">选择供应商</NativeSelectOption>
            {(providers.data ?? []).map(function (item) {
              return (
                <NativeSelectOption
                  key={item.id}
                  value={item.id}>
                  {item.name}
                </NativeSelectOption>
              )
            })}
          </NativeSelect>
          <Input
            placeholder="模型名（上游约定，如 gpt-4o-mini）"
            value={draft.name}
            onChange={function (event) {
              updateDraft({ ...draft, name: event.target.value })
            }}
          />
          <Input
            placeholder="显示名"
            value={draft.label}
            onChange={function (event) {
              updateDraft({ ...draft, label: event.target.value })
            }}
          />
          <Input
            type="number"
            min={0}
            placeholder="日配额 token（0 = 继承）"
            value={draft.dailyTokenQuota}
            onChange={function (event) {
              updateDraft({ ...draft, dailyTokenQuota: event.target.value })
            }}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            type="number"
            min={0}
            placeholder="上下文窗口（留空 = 未知）"
            value={draft.contextWindow}
            onChange={function (event) {
              updateDraft({ ...draft, contextWindow: event.target.value })
            }}
          />
          <div className="flex flex-wrap items-center gap-4 rounded-md border border-border/70 px-3 py-2">
            <div className="flex items-center gap-2">
              <Switch
                id="model-tools"
                checked={draft.tools}
                onCheckedChange={function (checked) {
                  updateDraft({ ...draft, tools: checked })
                }}
              />
              <Label htmlFor="model-tools">工具</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="model-reasoning"
                checked={draft.reasoning}
                onCheckedChange={function (checked) {
                  updateDraft({ ...draft, reasoning: checked })
                }}
              />
              <Label htmlFor="model-reasoning">推理</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="model-vision"
                checked={draft.vision}
                onCheckedChange={function (checked) {
                  updateDraft({ ...draft, vision: checked })
                }}
              />
              <Label htmlFor="model-vision">视觉</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="model-enabled"
                checked={draft.enabled}
                onCheckedChange={function (checked) {
                  updateDraft({ ...draft, enabled: checked })
                }}
              />
              <Label htmlFor="model-enabled">对外可见</Label>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            可见角色（不选 = 全部角色可见）
          </p>
          <div className="flex flex-wrap gap-2">
            {GATEWAY_MODEL_ROLES.map(function (role) {
              const isActive = draft.allowRoles.includes(role)
              return (
                <Button
                  key={role}
                  type="button"
                  size="sm"
                  variant={isActive ? 'default' : 'outline'}
                  onClick={function () {
                    toggleRole(role)
                  }}>
                  {role}
                </Button>
              )
            })}
          </div>
        </div>

        <Button
          disabled={createModel.isPending}
          onClick={function () {
            const providerID = draft.providerID || firstProviderID
            if (!providerID || !draft.name || !draft.label) {
              toast.error('填写供应商、模型名、显示名')
              return
            }
            createModel.mutate({
              providerID,
              name: draft.name,
              label: draft.label,
              allowRoles: draft.allowRoles.length > 0 ? draft.allowRoles : undefined,
              enabled: draft.enabled,
              dailyTokenQuota: Number(draft.dailyTokenQuota) || 0,
              capabilities: {
                tools: draft.tools,
                reasoning: draft.reasoning,
                vision: draft.vision
              },
              contextWindow: parseWindow(draft.contextWindow)
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
                          {formatCapabilities(model)} · 角色 {formatRoles(model.allowRoles)} · 配额{' '}
                          {model.dailyTokenQuota || '继承'} ·{' '}
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
