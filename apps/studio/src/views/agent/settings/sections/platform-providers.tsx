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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  CREATE_GATEWAY_PROVIDER,
  DELETE_GATEWAY_PROVIDER,
  GATEWAY_PROVIDER_KIND_LABELS,
  GATEWAY_PROVIDER_KINDS,
  GATEWAY_PROVIDER_STATUS_LABELS,
  GET_GATEWAY_PROVIDERS,
  UPDATE_GATEWAY_PROVIDER,
  type GatewayProvider
} from '@/apis/gateway.ts'
import { HttpError } from '@/utils/http.errors.ts'
import { DataTable, TableLoading } from '@/views/agent/settings/components/table.tsx'

/**
 * 平台 · 供应商：服务端 AI 网关的上游（真正的 Key 在这里托管）。
 *
 * 与「个人」组的模型页泾渭分明：那边是用户自己本机的 Key，这边是管理员配的、
 * 全平台共用的上游。服务地址填 OpenAI 兼容根路径（含 `/v1`），网关自己接
 * `/chat/completions`。
 */

const PROVIDERS_KEY = ['gateway', 'providers'] as const

interface ProviderDraft {
  id: string | null
  kind: string
  name: string
  baseUrl: string
  apiKey: string
  status: string
}

function emptyDraft(): ProviderDraft {
  return {
    id: null,
    kind: GATEWAY_PROVIDER_KINDS[0],
    name: '',
    baseUrl: '',
    apiKey: '',
    status: 'ACTIVE'
  }
}

function draftOf(provider: GatewayProvider): ProviderDraft {
  return {
    id: provider.id,
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: '',
    status: provider.status
  }
}

function PlatformProviderSection() {
  const [draft, updateDraft] = useState<ProviderDraft | null>(null)
  const [removing, updateRemoving] = useState<GatewayProvider | null>(null)
  const queryClient = useQueryClient()

  const providersQuery = useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: function () {
      return GET_GATEWAY_PROVIDERS()
    }
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['gateway'] })
  }

  const saveMutation = useMutation({
    async mutationFn(input: ProviderDraft) {
      // 留空表示不改动已托管的密钥，所以字段要先剔掉再发
      const apiKey = input.apiKey ? { apiKey: input.apiKey } : {}
      if (input.id) {
        return await UPDATE_GATEWAY_PROVIDER(input.id, {
          kind: input.kind,
          name: input.name,
          baseUrl: input.baseUrl,
          status: input.status,
          ...apiKey
        })
      }
      return await CREATE_GATEWAY_PROVIDER({
        kind: input.kind,
        name: input.name,
        baseUrl: input.baseUrl,
        status: input.status,
        ...apiKey
      })
    },
    async onSuccess() {
      toast.success(draft?.id ? '已更新供应商' : '已创建供应商')
      updateDraft(null)
      await refresh()
    },
    onError(error) {
      toast.error(HttpError(error).message || '保存失败')
    }
  })

  const removeMutation = useMutation({
    mutationFn(id: string) {
      return DELETE_GATEWAY_PROVIDER(id)
    },
    async onSuccess() {
      toast.success('已删除供应商')
      updateRemoving(null)
      await refresh()
    },
    onError: function (error) {
      toast.error(HttpError(error).message || '删除失败')
    }
  })

  const providers = providersQuery.data ?? []
  const isEditing = draft !== null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-medium">供应商</h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            平台共用的上游服务。API Key 由服务端加密托管，只回「是否已配置」。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={function () {
            updateDraft(emptyDraft())
          }}>
          <Icon icon="lucide:plus" />
          新增供应商
        </Button>
      </div>

      {providersQuery.isPending ? (
        <TableLoading />
      ) : providersQuery.isError ? (
        <p className="text-destructive py-6 text-sm">
          {HttpError(providersQuery.error).message || '供应商加载失败'}
        </p>
      ) : (
        <DataTable
          columns={[
            {
              key: 'name',
              title: '名称',
              render: function (row) {
                return <span className="font-medium">{row.name}</span>
              }
            },
            {
              key: 'kind',
              title: '类型',
              render: function (row) {
                return GATEWAY_PROVIDER_KIND_LABELS[row.kind] ?? row.kind
              }
            },
            {
              key: 'baseUrl',
              title: '服务地址',
              className: 'font-mono text-xs',
              render: function (row) {
                return <span className="text-muted-foreground">{row.baseUrl}</span>
              }
            },
            {
              key: 'status',
              title: '状态',
              render: function (row) {
                return (
                  <Badge variant={row.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                    {GATEWAY_PROVIDER_STATUS_LABELS[row.status] ?? row.status}
                  </Badge>
                )
              }
            },
            {
              key: 'apiKey',
              title: '密钥',
              render: function (row) {
                return row.hasApiKey ? '已托管' : '未配置'
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
                      aria-label={`编辑 ${row.name}`}
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
                      aria-label={`删除 ${row.name}`}
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
          rows={providers}
          rowKey={function (row) {
            return row.id
          }}
          empty="还没有供应商。先在这里登记上游，再去「平台模型」挂模型。"
        />
      )}

      <Dialog
        open={isEditing}
        onOpenChange={function (open) {
          if (!open) updateDraft(null)
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? '编辑供应商' : '新增供应商'}</DialogTitle>
            <DialogDescription>
              服务地址要填 OpenAI 兼容根路径（含 `/v1`）；网关会在其后接 `/chat/completions`。
            </DialogDescription>
          </DialogHeader>

          {draft ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-provider-kind">类型</Label>
                <Select
                  items={GATEWAY_PROVIDER_KIND_LABELS}
                  value={draft.kind}
                  onValueChange={function (value) {
                    if (value === null) return
                    updateDraft({ ...draft, kind: value })
                  }}>
                  <SelectTrigger
                    id="gateway-provider-kind"
                    className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GATEWAY_PROVIDER_KINDS.map(function (kind) {
                      return (
                        <SelectItem
                          key={kind}
                          value={kind}>
                          {GATEWAY_PROVIDER_KIND_LABELS[kind]}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-provider-name">名称</Label>
                <Input
                  id="gateway-provider-name"
                  value={draft.name}
                  placeholder="例如：线上 OpenAI"
                  onChange={function (event) {
                    updateDraft({ ...draft, name: event.target.value })
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-provider-base-url">服务地址</Label>
                <Input
                  id="gateway-provider-base-url"
                  value={draft.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={function (event) {
                    updateDraft({ ...draft, baseUrl: event.target.value })
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-provider-api-key">API Key</Label>
                <Input
                  id="gateway-provider-api-key"
                  type="password"
                  value={draft.apiKey}
                  placeholder={draft.id ? '留空表示不修改' : 'sk-…'}
                  onChange={function (event) {
                    updateDraft({ ...draft, apiKey: event.target.value })
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gateway-provider-status">状态</Label>
                <Select
                  items={GATEWAY_PROVIDER_STATUS_LABELS}
                  value={draft.status}
                  onValueChange={function (value) {
                    if (value === null) return
                    updateDraft({ ...draft, status: value })
                  }}>
                  <SelectTrigger
                    id="gateway-provider-status"
                    className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">启用</SelectItem>
                    <SelectItem value="DISABLED">停用</SelectItem>
                  </SelectContent>
                </Select>
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
            <DialogTitle>删除供应商</DialogTitle>
            <DialogDescription>
              删除「{removing?.name}」后，挂在这家上游下的模型会一起失效。此操作不可撤销。
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

export { PlatformProviderSection }
