import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  findPlatformBlocker,
  findPlatformRow,
  PLATFORM_PROVIDER_NAME
} from '@/features/chat/platform.ts'
import { PROVIDER_KIND_LABELS } from './constants.ts'
import { ProviderForm } from './form.tsx'
import { findProviders, PROVIDERS_KEY } from './query.ts'
import { collectProviderModels } from './row.ts'
import type { ProviderRow } from './row.ts'
import { toModelEntries } from './schema.ts'
import type { ProviderValues } from './schema.ts'
import { toIpcMessage } from '@/utils/ipc.errors.ts'

/**
 * 设置里的「模型」页，对照 Qoder：页头说明 + 添加模型，下面是个人模型列表。
 *
 * 添加和更新走对话框。行落 SQLite（`chat:provider.*`），Key 落主进程密钥库
 * （`assistant:key.*`，只有写 / 问有没有 / 删）。Provider 取自契约包预设表
 * （云厂商 + 本机 OpenAI 兼容端点），服务地址由用户确认/覆盖。
 *
 * 列表里还包含组织模型（平台网关那一行，`kind: 'gateway'`）：它由登录态与网关目录
 * 派生，这里只读展示、不给编辑入口。
 */

type ModelEntry = NonNullable<ProviderRow['models']>[number]

/** 新建/更新 provider，并在填了 Key 时写入密钥库 */
async function saveProvider(input: {
  id: string | null
  /** 原行的模型条目：表单只编辑模型名，能力声明要带回去（见 toModelEntries） */
  models: ModelEntry[] | null
  values: ProviderValues
}): Promise<string> {
  const { values } = input
  const payload = {
    kind: values.kind,
    name: values.name,
    baseUrl: values.baseUrl ? values.baseUrl : null,
    models: toModelEntries(values.models, input.models),
    model: values.model,
    enabled: values.enabled
  }

  const provider = input.id
    ? await itc.chat.provider.toUpdate({ id: input.id, ...payload })
    : await itc.chat.provider.toWrite(payload)

  if (values.apiKey) {
    await itc.assistant.key.toWrite({ providerID: provider.id, apiKey: values.apiKey })
  }
  return provider.id
}

async function removeProvider(id: string): Promise<void> {
  await itc.assistant.key.toRemove({ providerID: id })
  await itc.chat.provider.toRemove({ id })
}

function findModelTitle(provider: ProviderRow): string {
  return provider.model || provider.name || '未命名模型'
}

function findModelHint(provider: ProviderRow): string {
  const kind = PROVIDER_KIND_LABELS[provider.kind] ?? provider.kind
  const vendor = provider.name && provider.name !== provider.model ? provider.name : kind
  return provider.enabled ? vendor : `${vendor} · 已停用`
}

/** 组织模型那一行的说明：镜像了目录就报可用模型数，否则报阻塞原因 */
function findPlatformHint(platform: ProviderRow | null): string {
  if (platform) {
    const count = collectProviderModels(platform).length
    return count > 0 ? `已将 ${count} 个模型同步到本机` : '网关未返回模型目录'
  }
  return findPlatformBlocker() ?? '等待登录后同步'
}

function ProviderPanel() {
  const [editing, updateEditing] = useState<ProviderRow | null>(null)
  const [isCreating, updateCreating] = useState(false)
  const queryClient = useQueryClient()

  const providersQuery = useQuery({ queryKey: PROVIDERS_KEY, queryFn: findProviders })

  function closeForm() {
    updateEditing(null)
    updateCreating(false)
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['chat'] })
  }

  const saveMutation = useMutation({
    mutationFn: saveProvider,
    onSuccess: async function (_id, input) {
      toast.success(input.id ? '已更新模型' : '已添加模型')
      closeForm()
      await refresh()
    },
    onError: function (error) {
      toast.error(toIpcMessage(error, '保存失败'))
    }
  })

  const removeMutation = useMutation({
    mutationFn: removeProvider,
    onSuccess: async function () {
      toast.success('已删除模型')
      await refresh()
    },
    onError: function (error) {
      toast.error(toIpcMessage(error, '删除失败'))
    }
  })

  const providers = providersQuery.data ?? []
  const isOpen = isCreating || editing !== null

  const platform = findPlatformRow(providers)
  const personal = providers.filter(function (provider) {
    return provider.id !== platform?.id
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-medium">模型</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            组织模型由管理员在服务端配置，登录后自动出现在这里；个人模型用你自己的 API Key
            添加，密钥只写入主进程密钥库。两类模型都能跑工具与审批。
          </p>
        </div>
        <Button
          type="button"
          className="shrink-0"
          onClick={function () {
            updateCreating(true)
          }}>
          <Icon icon="lucide:plus" />
          添加模型
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">组织模型</h3>

        <div className="border-border flex flex-col gap-3 rounded-lg border px-3 py-3">
          <div className="flex items-center gap-3">
            <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
              <Icon
                icon="lucide:building"
                className="size-4"
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">
                {platform ? platform.name : PLATFORM_PROVIDER_NAME}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {findPlatformHint(platform)}
              </span>
            </div>
          </div>

          {platform ? (
            <div className="flex flex-wrap gap-1.5">
              {collectProviderModels(platform).map(function (model) {
                return (
                  <span
                    key={model.id}
                    className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs">
                    {model.name || model.id}
                  </span>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">个人模型</h3>

        {personal.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">
            还没有个人模型。本地的 Ollama、LM Studio，或任意 OpenAI 兼容服务都可以加。
          </p>
        ) : (
          <div className="border-border divide-border divide-y rounded-lg border">
            {personal.map(function (provider) {
              return (
                <div
                  key={provider.id}
                  className="flex items-center gap-3 px-3 py-3">
                  <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                    <Icon
                      icon="lucide:server"
                      className="size-4"
                    />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{findModelTitle(provider)}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {findModelHint(provider)}
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={function () {
                      updateEditing(provider)
                    }}>
                    <Icon icon="lucide:pencil" />
                    更新 API Key
                  </Button>

                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={removeMutation.isPending}
                    onClick={function () {
                      removeMutation.mutate(provider.id)
                    }}>
                    <Icon icon="lucide:trash" />
                    删除
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={function (open) {
          if (!open) closeForm()
        }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '更新 API Key' : '添加模型'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `为「${findModelTitle(editing)}」输入新的 API Key。旧密钥不会显示，留空表示不修改。`
                : '选择本机接入的 Provider 和模型。调用走你填的服务地址，费用由该服务结算。'}
            </DialogDescription>
          </DialogHeader>
          <ProviderForm
            key={editing?.id ?? 'new'}
            provider={editing}
            isSaving={saveMutation.isPending}
            isUpdating={editing !== null}
            submitLabel={editing ? '更新 API Key' : '添加模型'}
            onSubmit={function (values) {
              saveMutation.mutate({
                id: editing?.id ?? null,
                models: editing?.models ?? null,
                values
              })
            }}
            onCancel={closeForm}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { ProviderPanel }
