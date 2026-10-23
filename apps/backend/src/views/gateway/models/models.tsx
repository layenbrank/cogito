import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { groupBy } from 'lodash-es'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  DELETE_GATEWAY_ADMIN_MODEL,
  GATEWAY_MODEL_ROLES,
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

export default function ModelsView() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const focusID = searchParams.get('focus')
  const models = useQuery({ queryKey: ['gateway-admin-models'], queryFn: GET_GATEWAY_ADMIN_MODELS })
  const providers = useQuery({ queryKey: ['gateway-providers'], queryFn: GET_GATEWAY_PROVIDERS })
  const [sheetOpen, updateSheetOpen] = useState(false)
  const [pendingDelete, updatePendingDelete] = useState<GatewayModel | null>(null)
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
      updateSheetOpen(false)
      updateDraft(emptyDraft(draft.providerID))
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

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
                            角色 {formatRoles(model.allowRoles)} · 配额{' '}
                            {model.dailyTokenQuota || '继承'}
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
        description="模型名须与上游约定一致；可见角色留空表示全部可见。"
        submitLabel="创建"
        isPending={createModel.isPending}
        onOpenChange={function (open) {
          updateSheetOpen(open)
          if (open && !draft.providerID && providers.data?.[0]) {
            updateDraft(emptyDraft(providers.data[0].id))
          }
        }}
        onSubmit={function () {
          if (!draft.providerID || !draft.name || !draft.label) {
            toast.error('填写供应商、模型名、显示名')
            return
          }
          createModel.mutate({
            providerID: draft.providerID,
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
          <Label>模型名</Label>
          <Input
            placeholder="上游约定，如 gpt-4o-mini"
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
          <Label>日配额（token，0 = 继承）</Label>
          <Input
            type="number"
            min={0}
            value={draft.dailyTokenQuota}
            onChange={function (event) {
              updateDraft({ ...draft, dailyTokenQuota: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>上下文窗口（留空 = 未知）</Label>
          <Input
            type="number"
            min={0}
            value={draft.contextWindow}
            onChange={function (event) {
              updateDraft({ ...draft, contextWindow: event.target.value })
            }}
          />
        </div>
        <div className="space-y-3 rounded-md border border-border/70 p-3">
          <p className="text-sm font-medium">能力与可见性</p>
          <div className="flex flex-wrap gap-4">
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
        <div className="space-y-2">
          <Label>可见角色（不选 = 全部）</Label>
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
