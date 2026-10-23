import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { Icon } from '@iconify/react/offline'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_GATEWAY_PROVIDER,
  GATEWAY_PROVIDER_KIND_LABELS,
  GATEWAY_PROVIDER_KINDS,
  GET_GATEWAY_PROVIDERS,
  POST_GATEWAY_PROVIDER,
  PUT_GATEWAY_PROVIDER,
  type GatewayProvider
} from '@/apis/gateway.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { StatusBadge } from '@/components/console/status-badge.tsx'
import { HttpError } from '@/utils/http/errors.ts'

const ORDER_KEY = 'backend-provider-order'

type ProviderKind = (typeof GATEWAY_PROVIDER_KINDS)[number]

const KIND_ITEMS = GATEWAY_PROVIDER_KINDS.map(function (kind) {
  return { value: kind, label: GATEWAY_PROVIDER_KIND_LABELS[kind] }
})

function SortableProvider(props: {
  provider: GatewayProvider
  onToggle: (provider: GatewayProvider) => void
  onRemove: (provider: GatewayProvider) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.provider.id
  })

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1
      }}
      className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 hover:bg-muted/30">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="cursor-grab text-muted-foreground"
        aria-label="拖拽排序"
        {...attributes}
        {...listeners}>
        <Icon
          icon="lucide:grip-vertical"
          className="size-4"
        />
      </Button>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{props.provider.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {GATEWAY_PROVIDER_KIND_LABELS[props.provider.kind] ?? props.provider.kind} ·{' '}
          {props.provider.baseUrl}
          {props.provider.hasApiKey ? ' · 已托管密钥' : ' · 无密钥'}
        </p>
      </div>
      <StatusBadge status={props.provider.status} />
      <Button
        variant="outline"
        onClick={function () {
          props.onToggle(props.provider)
        }}>
        {props.provider.status === 'ACTIVE' ? '停用' : '启用'}
      </Button>
      <Button
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={function () {
          props.onRemove(props.provider)
        }}>
        删除
      </Button>
    </li>
  )
}

function findSavedOrder(ids: string[]): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as string[]
    return [
      ...saved.filter(function (id) {
        return ids.includes(id)
      }),
      ...ids.filter(function (id) {
        return !saved.includes(id)
      })
    ]
  } catch {
    return ids
  }
}

export default function ProvidersView() {
  const queryClient = useQueryClient()
  const providers = useQuery({ queryKey: ['gateway-providers'], queryFn: GET_GATEWAY_PROVIDERS })
  const [orderOverride, updateOrderOverride] = useState<string[] | null>(null)
  const [sheetOpen, updateSheetOpen] = useState(false)
  const [pendingDelete, updatePendingDelete] = useState<GatewayProvider | null>(null)
  const [draft, updateDraft] = useState<{
    kind: ProviderKind
    name: string
    baseUrl: string
    apiKey: string
  }>({
    kind: GATEWAY_PROVIDER_KINDS[0],
    name: '',
    baseUrl: '',
    apiKey: ''
  })

  const order = useMemo(
    function () {
      const ids = (providers.data ?? []).map(function (item) {
        return item.id
      })
      if (!ids.length) return []
      if (orderOverride) {
        return [
          ...orderOverride.filter(function (id) {
            return ids.includes(id)
          }),
          ...ids.filter(function (id) {
            return !orderOverride.includes(id)
          })
        ]
      }
      return findSavedOrder(ids)
    },
    [providers.data, orderOverride]
  )

  const createProvider = useMutation({
    mutationFn: POST_GATEWAY_PROVIDER,
    onSuccess() {
      toast.success('已创建供应商')
      void queryClient.invalidateQueries({ queryKey: ['gateway-providers'] })
      updateSheetOpen(false)
      updateDraft({ kind: GATEWAY_PROVIDER_KINDS[0], name: '', baseUrl: '', apiKey: '' })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const patchProvider = useMutation({
    mutationFn: function (provider: GatewayProvider) {
      return PUT_GATEWAY_PROVIDER(provider.id, {
        status: provider.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
      })
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ['gateway-providers'] })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const removeProvider = useMutation({
    mutationFn: DELETE_GATEWAY_PROVIDER,
    onSuccess() {
      toast.success('已删除')
      void queryClient.invalidateQueries({ queryKey: ['gateway-providers'] })
      updatePendingDelete(null)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const byId = new Map(
    (providers.data ?? []).map(function (item) {
      return [item.id, item]
    })
  )
  const rows = order
    .map(function (id) {
      return byId.get(id)
    })
    .filter(function (item): item is GatewayProvider {
      return Boolean(item)
    })

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(String(active.id))
    const newIndex = order.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(order, oldIndex, newIndex)
    updateOrderOverride(next)
    localStorage.setItem(ORDER_KEY, JSON.stringify(next))
  }

  return (
    <ConsolePage
      actions={
        <Button
          size="lg"
          className="h-10 px-4"
          onClick={function () {
            updateSheetOpen(true)
          }}>
          新建供应商
        </Button>
      }>
      <QueryState
        isLoading={providers.isLoading}
        isError={providers.isError}
        error={providers.error}
        onRetry={function () {
          void providers.refetch()
        }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}>
          <SortableContext
            items={order}
            strategy={verticalListSortingStrategy}>
            <ul>
              {rows.map(function (provider) {
                return (
                  <SortableProvider
                    key={provider.id}
                    provider={provider}
                    onToggle={function (item) {
                      patchProvider.mutate(item)
                    }}
                    onRemove={function (item) {
                      updatePendingDelete(item)
                    }}
                  />
                )
              })}
            </ul>
          </SortableContext>
        </DndContext>
        {!providers.isLoading && rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">暂无供应商</p>
        ) : null}
      </QueryState>

      <EntitySheet
        open={sheetOpen}
        title="新建供应商"
        description="API Key 写入后不可回读，仅显示是否已托管。"
        submitLabel="创建"
        isPending={createProvider.isPending}
        onOpenChange={updateSheetOpen}
        onSubmit={function () {
          if (!draft.name || !draft.baseUrl) {
            toast.error('填写名称与接口地址')
            return
          }
          createProvider.mutate({
            kind: draft.kind,
            name: draft.name,
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey || undefined
          })
        }}>
        <div className="space-y-2">
          <Label>名称</Label>
          <Input
            value={draft.name}
            onChange={function (event) {
              updateDraft({ ...draft, name: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>类型</Label>
          <Select
            items={KIND_ITEMS}
            value={draft.kind}
            onValueChange={function (value) {
              if (!value) return
              for (const kind of GATEWAY_PROVIDER_KINDS) {
                if (kind === value) {
                  updateDraft({ ...draft, kind })
                  return
                }
              }
            }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择供应商类型" />
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
        <div className="space-y-2">
          <Label>接口地址</Label>
          <Input
            placeholder="https://…"
            value={draft.baseUrl}
            onChange={function (event) {
              updateDraft({ ...draft, baseUrl: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>API Key（可选）</Label>
          <Input
            type="password"
            value={draft.apiKey}
            onChange={function (event) {
              updateDraft({ ...draft, apiKey: event.target.value })
            }}
          />
        </div>
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`删除供应商 ${pendingDelete?.name ?? ''}？`}
        description="关联模型可能受影响。确认后不可撤销。"
        confirmLabel="删除"
        destructive
        isPending={removeProvider.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingDelete(null)
        }}
        onConfirm={function () {
          if (pendingDelete) removeProvider.mutate(pendingDelete.id)
        }}
      />
    </ConsolePage>
  )
}
