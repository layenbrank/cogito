import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
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
import { useState } from 'react'
import { toast } from 'sonner'

import {
  CREATE_GATEWAY_MODEL,
  DELETE_GATEWAY_MODEL,
  GET_GATEWAY_ADMIN_MODELS,
  GET_GATEWAY_PROVIDERS,
  UPDATE_GATEWAY_MODEL,
  type GatewayModel
} from '@/apis/gateway.ts'
import { HttpError } from '@/utils/http.errors.ts'
import { DataTable, TableLoading } from '@/views/agent/settings/components/table.tsx'

/**
 * 平台 · 模型：目录里给用户挑的那些条目，以及它们的可见范围与配额。
 *
 * 这里的 `name` 是请求体里的 `model` 值（上游认识的名字），`label` 才是界面上
 * 显示的名字 —— 两者分开，免得为了好看的名字去改上游约定。
 */

const ADMIN_MODELS_KEY = ['gateway', 'admin-models'] as const

interface ModelDraft {
  id: string | null
  providerID: string
  name: string
  label: string
  /** 逗号分隔的角色白名单，空串 = 全角色可见 */
  allowRoles: string
  enabled: boolean
  dailyTokenQuota: string
  /** 能力声明：工具/推理/视觉。保存时三项都显式写库（表单即权威） */
  tools: boolean
  reasoning: boolean
  vision: boolean
  /** 上下文窗口（token）；空串 = 未知 */
  contextWindow: string
}

function parseRoles(raw: string): string[] | null {
  const roles = raw
    .split(',')
    .map(function (item) {
      return item.trim()
    })
    .filter(Boolean)

  return roles.length > 0 ? roles : null
}

/** 正数才落库；空串 / 0 / 负数都表示「未知」，服务端据此清空该列 */
function parseWindow(raw: string): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function emptyDraft(providerID: string): ModelDraft {
  return {
    id: null,
    providerID,
    name: '',
    label: '',
    allowRoles: '',
    enabled: true,
    dailyTokenQuota: '0',
    tools: true,
    reasoning: false,
    vision: false,
    contextWindow: ''
  }
}

function draftOf(model: GatewayModel): ModelDraft {
  return {
    id: model.id,
    providerID: model.providerID,
    name: model.name,
    label: model.label,
    allowRoles: (model.allowRoles ?? []).join(', '),
    enabled: model.enabled,
    dailyTokenQuota: String(model.dailyTokenQuota ?? 0),
    tools: model.capabilities?.tools ?? true,
    reasoning: model.capabilities?.reasoning ?? false,
    vision: model.capabilities?.vision ?? false,
    contextWindow: model.contextWindow ? String(model.contextWindow) : ''
  }
}

function CapabilityCell(props: { model: GatewayModel }) {
  const { capabilities } = props.model
  const tags = [capabilities?.tools === false ? '仅聊天' : '工具']
  if (capabilities?.reasoning) tags.push('推理')
  if (capabilities?.vision) tags.push('视觉')

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map(function (tag) {
        return (
          <Badge
            key={tag}
            variant="outline">
            {tag}
          </Badge>
        )
      })}
    </div>
  )
}

function PlatformModelSection() {
  const [draft, updateDraft] = useState<ModelDraft | null>(null)
  const [removing, updateRemoving] = useState<GatewayModel | null>(null)
  const queryClient = useQueryClient()

  const providersQuery = useQuery({
    queryKey: ['gateway', 'providers'],
    queryFn: function () {
      return GET_GATEWAY_PROVIDERS()
    }
  })
  const modelsQuery = useQuery({
    queryKey: ADMIN_MODELS_KEY,
    queryFn: function () {
      return GET_GATEWAY_ADMIN_MODELS()
    }
  })

  const providers = providersQuery.data ?? []
  const models = modelsQuery.data ?? []

  function findProviderName(id: string): string {
    const provider = providers.find(function (item) {
      return item.id === id
    })
    return provider ? provider.name : id
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['gateway'] })
  }

  const saveMutation = useMutation({
    mutationFn: async function (input: ModelDraft) {
      const quota = Number(input.dailyTokenQuota)
      const payload = {
        name: input.name,
        label: input.label,
        allowRoles: parseRoles(input.allowRoles),
        enabled: input.enabled,
        dailyTokenQuota: Number.isFinite(quota) && quota > 0 ? Math.floor(quota) : 0,
        capabilities: { tools: input.tools, reasoning: input.reasoning, vision: input.vision },
        contextWindow: parseWindow(input.contextWindow)
      }

      if (input.id) return await UPDATE_GATEWAY_MODEL(input.id, payload)

      return await CREATE_GATEWAY_MODEL({ ...payload, providerID: input.providerID })
    },
    onSuccess: async function () {
      toast.success(draft?.id ? '已更新模型' : '已创建模型')
      updateDraft(null)
      await refresh()
    },
    onError: function (error) {
      toast.error(HttpError(error).message || '保存失败')
    }
  })

  const removeMutation = useMutation({
    mutationFn: function (id: string) {
      return DELETE_GATEWAY_MODEL(id)
    },
    onSuccess: async function () {
      toast.success('已删除模型')
      updateRemoving(null)
      await refresh()
    },
    onError: function (error) {
      toast.error(HttpError(error).message || '删除失败')
    }
  })

  const canCreate = providers.length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-medium">模型</h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            目录里对外可见的条目。停用或角色不匹配的条目不会出现在用户的模型列表里。 内置的{' '}
            <code className="font-mono">auto</code>{' '}
            自动排在用户端目录首位、无需也无法在这里维护，它会挑一条支持工具的条目。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={!canCreate}
          onClick={function () {
            updateDraft(emptyDraft(providers[0]?.id ?? ''))
          }}>
          <Icon icon="lucide:plus" />
          新增模型
        </Button>
      </div>

      {modelsQuery.isPending ? (
        <TableLoading />
      ) : modelsQuery.isError ? (
        <p className="text-destructive py-6 text-sm">
          {HttpError(modelsQuery.error).message || '模型加载失败'}
        </p>
      ) : (
        <DataTable
          columns={[
            {
              key: 'label',
              title: '显示名',
              render: function (row) {
                return <span className="font-medium">{row.label}</span>
              }
            },
            {
              key: 'name',
              title: '模型名',
              className: 'font-mono text-xs',
              render: function (row) {
                return <span className="text-muted-foreground">{row.name}</span>
              }
            },
            {
              key: 'providerID',
              title: '供应商',
              render: function (row) {
                return findProviderName(row.providerID)
              }
            },
            {
              key: 'allowRoles',
              title: '可见角色',
              render: function (row) {
                const roles = row.allowRoles ?? []
                return roles.length === 0 ? '全部' : roles.join('、')
              }
            },
            {
              key: 'capabilities',
              title: '能力',
              render: function (row) {
                return <CapabilityCell model={row} />
              }
            },
            {
              key: 'contextWindow',
              title: '上下文',
              render: function (row) {
                return row.contextWindow ? (
                  row.contextWindow.toLocaleString('en-US')
                ) : (
                  <span className="text-muted-foreground">未知</span>
                )
              }
            },
            {
              key: 'dailyTokenQuota',
              title: '日配额',
              render: function (row) {
                return row.dailyTokenQuota > 0
                  ? row.dailyTokenQuota.toLocaleString('en-US')
                  : '继承租户'
              }
            },
            {
              key: 'enabled',
              title: '状态',
              render: function (row) {
                return (
                  <Badge variant={row.enabled ? 'secondary' : 'outline'}>
                    {row.enabled ? '启用' : '停用'}
                  </Badge>
                )
              }
            },
            {
              key: 'actions',
              title: '',
              className: 'w-0',
              render: function (row) {
                return (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`编辑 ${row.label}`}
                      onClick={function () {
                        updateDraft(draftOf(row))
                      }}>
                      <Icon icon="lucide:pencil" />
                      编辑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`删除 ${row.label}`}
                      onClick={function () {
                        updateRemoving(row)
                      }}>
                      <Icon icon="lucide:trash" />
                      删除
                    </Button>
                  </div>
                )
              }
            }
          ]}
          rows={models}
          rowKey={function (row) {
            return row.id
          }}
          empty={canCreate ? '还没有模型。' : '还没有模型。请先到「供应商」登记上游。'}
        />
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={function (open) {
          if (!open) updateDraft(null)
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? '编辑模型' : '新增模型'}</DialogTitle>
            <DialogDescription>
              模型名要和上游约定的完全一致（大小写敏感），
              <code className="font-mono">auto</code> 是网关保留名不能占用。
              {draft?.id ? '挂到哪家供应商创建后不可更改。' : ''}
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-model-provider">供应商</Label>
                <Select
                  items={providers.map(function (provider) {
                    return { value: provider.id, label: provider.name }
                  })}
                  value={draft.providerID}
                  disabled={draft.id !== null}
                  onValueChange={function (value) {
                    if (value === null) return
                    updateDraft({ ...draft, providerID: value })
                  }}>
                  <SelectTrigger
                    id="gateway-model-provider"
                    className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map(function (provider) {
                      return (
                        <SelectItem
                          key={provider.id}
                          value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-model-name">模型名</Label>
                <Input
                  id="gateway-model-name"
                  value={draft.name}
                  placeholder="gpt-5.4-mini"
                  onChange={function (event) {
                    updateDraft({ ...draft, name: event.target.value })
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-model-label">显示名</Label>
                <Input
                  id="gateway-model-label"
                  value={draft.label}
                  placeholder="GPT-4o mini"
                  onChange={function (event) {
                    updateDraft({ ...draft, label: event.target.value })
                  }}
                />
              </div>

              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">能力声明</span>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    随目录下发：客户端据此决定是否给这个模型挂工具。未声明时按「支持工具」处理。
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="gateway-model-tools">支持工具调用</Label>
                  <Switch
                    id="gateway-model-tools"
                    checked={draft.tools}
                    aria-label="支持工具调用"
                    onCheckedChange={function (checked) {
                      updateDraft({ ...draft, tools: checked })
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="gateway-model-reasoning">推理模型</Label>
                  <Switch
                    id="gateway-model-reasoning"
                    checked={draft.reasoning}
                    aria-label="推理模型"
                    onCheckedChange={function (checked) {
                      updateDraft({ ...draft, reasoning: checked })
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="gateway-model-vision">支持图片输入</Label>
                  <Switch
                    id="gateway-model-vision"
                    checked={draft.vision}
                    aria-label="支持图片输入"
                    onCheckedChange={function (checked) {
                      updateDraft({ ...draft, vision: checked })
                    }}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="gateway-model-window">上下文窗口</Label>
                  <Input
                    id="gateway-model-window"
                    type="number"
                    min={0}
                    placeholder="128000（留空 = 未知）"
                    value={draft.contextWindow}
                    onChange={function (event) {
                      updateDraft({ ...draft, contextWindow: event.target.value })
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-model-roles">可见角色</Label>
                <Input
                  id="gateway-model-roles"
                  value={draft.allowRoles}
                  placeholder="留空 = 全部；多个用逗号分隔，例如 ADMIN, USER"
                  onChange={function (event) {
                    updateDraft({ ...draft, allowRoles: event.target.value })
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-model-quota">日 token 配额</Label>
                <Input
                  id="gateway-model-quota"
                  type="number"
                  min={0}
                  value={draft.dailyTokenQuota}
                  onChange={function (event) {
                    updateDraft({ ...draft, dailyTokenQuota: event.target.value })
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="gateway-model-enabled">对外可见</Label>
                <Switch
                  id="gateway-model-enabled"
                  checked={draft.enabled}
                  aria-label="对外可见"
                  onCheckedChange={function (checked) {
                    updateDraft({ ...draft, enabled: checked })
                  }}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={function () {
                updateDraft(null)
              }}>
              取消
            </Button>
            <Button
              type="button"
              disabled={saveMutation.isPending}
              onClick={function () {
                if (draft) saveMutation.mutate(draft)
              }}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removing !== null}
        onOpenChange={function (open) {
          if (!open) updateRemoving(null)
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除模型</DialogTitle>
            <DialogDescription>
              删除「{removing?.label}」后，已选它的会话会退回默认模型。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={function () {
                updateRemoving(null)
              }}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={function () {
                if (removing) removeMutation.mutate(removing.id)
              }}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { PlatformModelSection }
