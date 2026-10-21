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
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import {
  NativeSelect,
  NativeSelectOption
} from '@i-thinking/design/components/native-select'
import { Icon } from '@iconify/react/offline'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_GATEWAY_PROVIDER,
  GATEWAY_PROVIDER_KIND_LABELS,
  GATEWAY_PROVIDER_KINDS,
  GATEWAY_PROVIDER_STATUS_LABELS,
  GET_GATEWAY_PROVIDERS,
  POST_GATEWAY_PROVIDER,
  PUT_GATEWAY_PROVIDER,
  type GatewayProvider
} from '@/apis/gateway.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
import { HttpError } from '@/utils/http/errors.ts'

const ORDER_KEY = 'backend-provider-order'

type ProviderKind = (typeof GATEWAY_PROVIDER_KINDS)[number]

function parseProviderKind(value: string): ProviderKind {
  for (const kind of GATEWAY_PROVIDER_KINDS) {
    if (kind === value) return kind
  }
  return GATEWAY_PROVIDER_KINDS[0]
}

function SortableProvider(props: {
  provider: GatewayProvider
  onToggle: (provider: GatewayProvider) => void
  onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.provider.id
  })
  const kindLabel =
    GATEWAY_PROVIDER_KIND_LABELS[props.provider.kind] ?? props.provider.kind
  const statusLabel =
    GATEWAY_PROVIDER_STATUS_LABELS[props.provider.status] ?? props.provider.status

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1
      }}
      className="flex items-center gap-3 border-b border-border/70 py-3">
      <button
        type="button"
        className="cursor-grab rounded p-1 text-muted-foreground"
        aria-label="拖拽排序"
        {...attributes}
        {...listeners}>
        <Icon
          icon="lucide:grip-vertical"
          className="size-4"
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{props.provider.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {kindLabel} · {props.provider.baseUrl}
          {props.provider.hasApiKey ? ' · 已托管密钥' : ' · 无密钥'} · {statusLabel}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={function () {
          props.onToggle(props.provider)
        }}>
        {props.provider.status === 'ACTIVE' ? '停用' : '启用'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={function () {
          if (!window.confirm(`删除供应商 ${props.provider.name}？`)) return
          props.onRemove(props.provider.id)
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
    <div>
      <PageHeader
        title="供应商"
        description="上游模型供应商。列表可拖拽调整个人展示序（本地）。密钥只写不读。"
      />
      <div className="mb-6 grid gap-3 rounded-xl border border-border/80 p-4 md:grid-cols-5">
        <Input
          placeholder="名称"
          value={draft.name}
          onChange={function (event) {
            updateDraft({ ...draft, name: event.target.value })
          }}
        />
        <NativeSelect
          className="w-full"
          aria-label="供应商类型"
          value={draft.kind}
          onChange={function (event) {
            updateDraft({ ...draft, kind: parseProviderKind(event.target.value) })
          }}>
          {GATEWAY_PROVIDER_KINDS.map(function (kind) {
            return (
              <NativeSelectOption
                key={kind}
                value={kind}>
                {GATEWAY_PROVIDER_KIND_LABELS[kind]}
              </NativeSelectOption>
            )
          })}
        </NativeSelect>
        <Input
          placeholder="baseUrl（OpenAI 兼容根路径）"
          value={draft.baseUrl}
          onChange={function (event) {
            updateDraft({ ...draft, baseUrl: event.target.value })
          }}
        />
        <Input
          placeholder="API Key（可选）"
          type="password"
          value={draft.apiKey}
          onChange={function (event) {
            updateDraft({ ...draft, apiKey: event.target.value })
          }}
        />
        <Button
          onClick={function () {
            if (!draft.name || !draft.baseUrl) {
              toast.error('填写名称与 baseUrl')
              return
            }
            createProvider.mutate({
              kind: draft.kind,
              name: draft.name,
              baseUrl: draft.baseUrl,
              apiKey: draft.apiKey || undefined,
              status: 'ACTIVE'
            })
          }}>
          创建
        </Button>
      </div>

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
                  onRemove={function (id) {
                    removeProvider.mutate(id)
                  }}
                />
              )
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}
