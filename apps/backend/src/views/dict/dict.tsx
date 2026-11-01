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
import { Tabs, TabsList, TabsTrigger } from '@cogito/design/components/tabs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_DICT_CLAIM,
  GET_DICT_ITEMS,
  GET_DICT_TENANT,
  GET_DICT_TYPES,
  POST_DICT_CLAIMS,
  POST_DICT_ITEM_ALLOCATE,
  POST_DICT_TYPE,
  PUT_DICT_ITEM,
  PUT_DICT_TENANT_ITEMS,
  PUT_DICT_TYPE,
  type DictClaim,
  type DictItem,
  type DictTypeItem
} from '@/apis/dict.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { FilterBar } from '@/components/console/filter-bar.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { HttpError } from '@/utils/http/errors.ts'

interface TenantRow {
  typeCode: string
  typeName: string
  value: string
  key: string
  label: string
  enabled: boolean
  isDefault: boolean
}

function stopRowClick(event: { stopPropagation(): void }) {
  event.stopPropagation()
}

function boolBadge(enabled: boolean) {
  return enabled ? (
    <Badge variant="success">启用</Badge>
  ) : (
    <Badge variant="destructive">停用</Badge>
  )
}

export default function DictView() {
  const queryClient = useQueryClient()
  const [tab, updateTab] = useState('pool')
  const [poolKeyword, updatePoolKeyword] = useState('')
  const [selectedTypeCode, updateSelectedTypeCode] = useState<string | null>(null)
  const [tenantInput, updateTenantInput] = useState('')
  const [loadedTenantId, updateLoadedTenantId] = useState<string | null>(null)

  const [poolSheetOpen, updatePoolSheetOpen] = useState(false)
  const [editingPoolItem, updateEditingPoolItem] = useState<DictItem | null>(null)
  const [allocateOpen, updateAllocateOpen] = useState(false)
  const [allocateDraft, updateAllocateDraft] = useState({ key: '', label: '', sort: '' })

  const [typeCreateOpen, updateTypeCreateOpen] = useState(false)
  const [typeEditOpen, updateTypeEditOpen] = useState(false)
  const [typeDraft, updateTypeDraft] = useState({ code: '', name: '', description: '' })

  const [claimOpen, updateClaimOpen] = useState(false)
  const [claimDraft, updateClaimDraft] = useState({
    value: '',
    sort: '10',
    isDefault: false,
    label: ''
  })
  const [claimEditOpen, updateClaimEditOpen] = useState(false)
  const [editingClaim, updateEditingClaim] = useState<DictTypeItem | null>(null)
  const [claimEditDraft, updateClaimEditDraft] = useState({
    label: '',
    sort: '',
    isDefault: false
  })
  const [pendingUnclaim, updatePendingUnclaim] = useState<DictTypeItem | null>(null)

  const [tenantEditOpen, updateTenantEditOpen] = useState(false)
  const [editingTenantRow, updateEditingTenantRow] = useState<TenantRow | null>(null)
  const [tenantEditDraft, updateTenantEditDraft] = useState({ label: '', enabled: true })

  const items = useQuery({ queryKey: ['dict-items'], queryFn: GET_DICT_ITEMS })
  const types = useQuery({ queryKey: ['dict-types'], queryFn: GET_DICT_TYPES })

  const tenantView = useQuery({
    queryKey: ['dict-tenant', loadedTenantId],
    queryFn: function () {
      return GET_DICT_TENANT(loadedTenantId!)
    },
    enabled: Boolean(loadedTenantId)
  })

  const selectedType = useMemo(
    function () {
      const code = selectedTypeCode
      if (!code) return null
      return (types.data ?? []).find(function (row) {
        return row.code === code
      })
    },
    [selectedTypeCode, types.data]
  )

  const filteredPool = useMemo(
    function () {
      const needle = poolKeyword.trim().toLowerCase()
      const rows = items.data ?? []
      if (!needle) return rows
      return rows.filter(function (row) {
        return (
          row.value.toLowerCase().includes(needle) ||
          row.key.toLowerCase().includes(needle) ||
          row.label.toLowerCase().includes(needle)
        )
      })
    },
    [items.data, poolKeyword]
  )

  /** value → 已认领该条目的 type code（同一 value 可被多 type 复用） */
  const claimersByValue = useMemo(
    function () {
      const map = new Map<string, string[]>()
      for (const type of types.data ?? []) {
        for (const item of type.items) {
          const codes = map.get(item.value) ?? []
          codes.push(type.code)
          map.set(item.value, codes)
        }
      }
      return map
    },
    [types.data]
  )

  /** 当前 type 尚未认领的池条目（含已被其他 type 认领的，便于复用） */
  const claimableValues = useMemo(
    function () {
      if (!selectedType) return items.data ?? []
      const claimed = new Set(
        selectedType.items.map(function (item) {
          return item.value
        })
      )
      return (items.data ?? []).filter(function (item) {
        return !claimed.has(item.value)
      })
    },
    [items.data, selectedType]
  )

  const tenantRows = useMemo(
    function () {
      const view = tenantView.data
      if (!view) return []
      const rows: TenantRow[] = []
      for (const type of view.types) {
        for (const item of type.items) {
          rows.push({
            typeCode: type.code,
            typeName: type.name,
            value: item.value,
            key: item.key,
            label: item.label,
            enabled: item.enabled,
            isDefault: item.isDefault
          })
        }
      }
      rows.sort(function (a, b) {
        if (a.typeCode !== b.typeCode) return a.typeCode.localeCompare(b.typeCode)
        return a.value.localeCompare(b.value)
      })
      return rows
    },
    [tenantView.data]
  )

  function invalidateDict() {
    void queryClient.invalidateQueries({ queryKey: ['dict-items'] })
    void queryClient.invalidateQueries({ queryKey: ['dict-types'] })
    if (loadedTenantId) {
      void queryClient.invalidateQueries({ queryKey: ['dict-tenant', loadedTenantId] })
    }
  }

  const patchPoolItem = useMutation({
    mutationFn: function (input: { value: string; label?: string; enabled?: boolean; sort?: number }) {
      return PUT_DICT_ITEM(input.value, {
        label: input.label,
        enabled: input.enabled,
        sort: input.sort
      })
    },
    onSuccess() {
      toast.success('已更新全局池条目')
      invalidateDict()
      updatePoolSheetOpen(false)
      updateEditingPoolItem(null)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const allocateItem = useMutation({
    mutationFn: POST_DICT_ITEM_ALLOCATE,
    onSuccess() {
      toast.success('已分配新 value')
      invalidateDict()
      updateAllocateOpen(false)
      updateAllocateDraft({ key: '', label: '', sort: '' })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const createType = useMutation({
    mutationFn: POST_DICT_TYPE,
    onSuccess(row) {
      toast.success('已创建字典类型')
      invalidateDict()
      updateTypeCreateOpen(false)
      updateSelectedTypeCode(row.code)
      updateTypeDraft({ code: '', name: '', description: '' })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const patchType = useMutation({
    mutationFn: function (input: { code: string; name: string; description?: string | null }) {
      return PUT_DICT_TYPE(input.code, {
        name: input.name,
        description: input.description || null
      })
    },
    onSuccess() {
      toast.success('已更新类型元数据')
      invalidateDict()
      updateTypeEditOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const claimItems = useMutation({
    mutationFn: function (input: { code: string; claims: DictClaim[] }) {
      return POST_DICT_CLAIMS(input.code, input.claims)
    },
    onSuccess() {
      toast.success('已认领条目')
      invalidateDict()
      updateClaimOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const replaceClaim = useMutation({
    mutationFn: async function (input: {
      code: string
      value: string
      claim: DictClaim
    }) {
      await DELETE_DICT_CLAIM(input.code, input.value)
      return POST_DICT_CLAIMS(input.code, [input.claim])
    },
    onSuccess() {
      toast.success('已更新类型级条目')
      invalidateDict()
      updateClaimEditOpen(false)
      updateEditingClaim(null)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const removeClaim = useMutation({
    mutationFn: function (input: { code: string; value: string }) {
      return DELETE_DICT_CLAIM(input.code, input.value)
    },
    onSuccess() {
      toast.success('已取消认领')
      invalidateDict()
      updatePendingUnclaim(null)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const upsertTenant = useMutation({
    mutationFn: function (input: {
      tenantId: string
      typeCode: string
      value: string
      label?: string | null
      enabled?: boolean | null
    }) {
      return PUT_DICT_TENANT_ITEMS(input.tenantId, [
        {
          typeCode: input.typeCode,
          value: input.value,
          label: input.label,
          enabled: input.enabled
        }
      ])
    },
    onSuccess() {
      toast.success('已写入租户覆盖')
      invalidateDict()
      updateTenantEditOpen(false)
      updateEditingTenantRow(null)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const [poolEditState, updatePoolEditState] = useState({
    label: '',
    enabled: true,
    sort: ''
  })

  return (
    <ConsolePage
      toolbar={
        <Tabs
          value={tab}
          onValueChange={function (value) {
            updateTab(value)
          }}>
          <TabsList variant="line" className="h-10">
            <TabsTrigger value="pool">全局池</TabsTrigger>
            <TabsTrigger value="types">类型认领</TabsTrigger>
            <TabsTrigger value="tenant">租户覆盖</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      actions={
        tab === 'pool' ? (
          <Button
            size="lg"
            className="h-10 px-4"
            onClick={function () {
              updateAllocateOpen(true)
            }}>
            分配条目
          </Button>
        ) : tab === 'types' ? (
          <Button
            size="lg"
            className="h-10 px-4"
            onClick={function () {
              updateTypeDraft({ code: '', name: '', description: '' })
              updateTypeCreateOpen(true)
            }}>
            新建类型
          </Button>
        ) : null
      }>
      {tab === 'pool' ? (
        <QueryState
          isLoading={items.isLoading}
          isError={items.isError}
          error={items.error}
          onRetry={function () {
            void items.refetch()
          }}>
          <div className="border-b border-border/60 px-3 py-2">
            <FilterBar
              search={poolKeyword}
              searchPlaceholder="搜索 value / key / 标签"
              onSearchChange={updatePoolKeyword}
            />
          </div>
          <DataTable
            columns={[
              {
                key: 'value',
                title: 'Value',
                className: 'font-mono text-xs',
                render(row) {
                  return row.value
                }
              },
              {
                key: 'key',
                title: 'Key',
                className: 'font-mono text-xs',
                render(row) {
                  return row.key
                }
              },
              {
                key: 'label',
                title: '标签',
                render(row) {
                  return row.label
                }
              },
              {
                key: 'claimers',
                title: '认领类型',
                render(row) {
                  const codes = claimersByValue.get(row.value) ?? []
                  if (codes.length === 0) {
                    return <span className="text-muted-foreground">未认领</span>
                  }
                  return (
                    <div className="flex flex-wrap gap-1">
                      {codes.map(function (code) {
                        return (
                          <Badge key={code} variant="outline" className="font-mono text-[10px]">
                            {code}
                          </Badge>
                        )
                      })}
                    </div>
                  )
                }
              },
              {
                key: 'enabled',
                title: '状态',
                render(row) {
                  return boolBadge(row.enabled)
                }
              },
              {
                key: 'sort',
                title: '排序',
                className: 'tabular-nums',
                render(row) {
                  return row.sort
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
                      onClick={function (event) {
                        stopRowClick(event)
                        updateEditingPoolItem(row)
                        updatePoolEditState({
                          label: row.label,
                          enabled: row.enabled,
                          sort: String(row.sort)
                        })
                        updatePoolSheetOpen(true)
                      }}>
                      编辑
                    </Button>
                  )
                }
              }
            ]}
            rows={filteredPool}
            rowKey={function (row) {
              return row.value
            }}
            emptyTitle="全局池为空"
            emptyActionLabel="分配条目"
            onEmptyAction={function () {
              updateAllocateOpen(true)
            }}
          />
        </QueryState>
      ) : null}

      {tab === 'types' ? (
        <QueryState
          isLoading={types.isLoading}
          isError={types.isError}
          error={types.error}
          onRetry={function () {
            void types.refetch()
          }}>
          <div className="flex flex-wrap items-end gap-3 border-b border-border/60 px-3 py-3">
            <div className="min-w-[14rem] flex-1 space-y-2">
              <Label>字典类型</Label>
              <Select
                value={selectedTypeCode || null}
                onValueChange={function (value) {
                  updateSelectedTypeCode(value)
                }}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  {(types.data ?? []).map(function (row) {
                    return (
                      <SelectItem key={row.code} value={row.code}>
                        {row.name} ({row.code})
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            {selectedType ? (
              <div className="flex flex-wrap gap-2 pb-0.5">
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={function () {
                    updateTypeDraft({
                      code: selectedType.code,
                      name: selectedType.name,
                      description: selectedType.description ?? ''
                    })
                    updateTypeEditOpen(true)
                  }}>
                  编辑类型
                </Button>
                <Button
                  className="h-10"
                  onClick={function () {
                    updateClaimDraft({
                      value: claimableValues[0]?.value ?? '',
                      sort: '10',
                      isDefault: false,
                      label: ''
                    })
                    updateClaimOpen(true)
                  }}
                  disabled={claimableValues.length === 0}>
                  认领条目
                </Button>
              </div>
            ) : null}
          </div>
          {selectedType ? (
            <>
              {selectedType.description ? (
                <p className="border-b border-border/40 px-3 py-2 text-sm text-muted-foreground">
                  {selectedType.description}
                </p>
              ) : null}
              <DataTable
                columns={[
                  {
                    key: 'value',
                    title: 'Value',
                    className: 'font-mono text-xs',
                    render(row) {
                      return row.value
                    }
                  },
                  {
                    key: 'key',
                    title: 'Key',
                    className: 'font-mono text-xs',
                    render(row) {
                      return row.key
                    }
                  },
                  {
                    key: 'label',
                    title: '展示标签',
                    render(row) {
                      return row.label
                    }
                  },
                  {
                    key: 'default',
                    title: '默认',
                    render(row) {
                      return row.isDefault ? <Badge variant="secondary">默认</Badge> : '—'
                    }
                  },
                  {
                    key: 'enabled',
                    title: '状态',
                    render(row) {
                      return boolBadge(row.enabled)
                    }
                  },
                  {
                    key: 'sort',
                    title: '排序',
                    className: 'tabular-nums',
                    render(row) {
                      return row.sort
                    }
                  },
                  {
                    key: 'actions',
                    title: '操作',
                    headerClassName: 'text-right',
                    className: 'text-right',
                    render(row) {
                      return (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            onClick={function (event) {
                              stopRowClick(event)
                              updateEditingClaim(row)
                              updateClaimEditDraft({
                                label: row.label,
                                sort: String(row.sort),
                                isDefault: row.isDefault
                              })
                              updateClaimEditOpen(true)
                            }}>
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={function (event) {
                              stopRowClick(event)
                              updatePendingUnclaim(row)
                            }}>
                            取消认领
                          </Button>
                        </div>
                      )
                    }
                  }
                ]}
                rows={selectedType.items}
                rowKey={function (row) {
                  return row.value
                }}
                emptyTitle="该类型尚未认领条目"
                emptyActionLabel="认领条目"
                onEmptyAction={function () {
                  updateClaimOpen(true)
                }}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
              请选择字典类型
            </div>
          )}
        </QueryState>
      ) : null}

      {tab === 'tenant' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-end gap-3 border-b border-border/60 px-3 py-3">
            <div className="min-w-[16rem] flex-1 space-y-2">
              <Label>租户 ID</Label>
              <Input
                className="h-10 font-mono text-sm"
                placeholder="UUID"
                value={tenantInput}
                onChange={function (event) {
                  updateTenantInput(event.target.value)
                }}
              />
            </div>
            <Button
              className="h-10 px-4"
              disabled={!tenantInput.trim() || tenantView.isFetching}
              onClick={function () {
                const id = tenantInput.trim()
                if (!id) {
                  toast.error('填写租户 ID')
                  return
                }
                updateLoadedTenantId(id)
              }}>
              加载合并视图
            </Button>
          </div>
          <QueryState
            isLoading={Boolean(loadedTenantId) && tenantView.isLoading}
            isError={tenantView.isError}
            error={tenantView.error}
            onRetry={function () {
              void tenantView.refetch()
            }}>
            <DataTable
              columns={[
                {
                  key: 'type',
                  title: '类型',
                  render(row) {
                    return (
                      <span className="text-xs">
                        {row.typeName}
                        <span className="ms-1 font-mono text-muted-foreground">({row.typeCode})</span>
                      </span>
                    )
                  }
                },
                {
                  key: 'value',
                  title: 'Value',
                  className: 'font-mono text-xs',
                  render(row) {
                    return row.value
                  }
                },
                {
                  key: 'key',
                  title: 'Key',
                  className: 'font-mono text-xs',
                  render(row) {
                    return row.key
                  }
                },
                {
                  key: 'label',
                  title: '合并标签',
                  render(row) {
                    return row.label
                  }
                },
                {
                  key: 'enabled',
                  title: '状态',
                  render(row) {
                    return boolBadge(row.enabled)
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
                        onClick={function (event) {
                          stopRowClick(event)
                          updateEditingTenantRow(row)
                          updateTenantEditDraft({ label: row.label, enabled: row.enabled })
                          updateTenantEditOpen(true)
                        }}>
                        覆盖
                      </Button>
                    )
                  }
                }
              ]}
              rows={tenantRows}
              rowKey={function (row) {
                return `${row.typeCode}:${row.value}`
              }}
              emptyTitle={loadedTenantId ? '该租户暂无字典条目' : '输入租户 ID 后加载'}
            />
          </QueryState>
        </div>
      ) : null}

      <EntitySheet
        open={poolSheetOpen}
        title="编辑全局池条目"
        description="value / key 不可改；停用后成员面不再展示。"
        isPending={patchPoolItem.isPending}
        onOpenChange={function (open) {
          updatePoolSheetOpen(open)
          if (!open) updateEditingPoolItem(null)
        }}
        onSubmit={function () {
          if (!editingPoolItem) return
          const sort = Number(poolEditState.sort)
          if (!poolEditState.label.trim() || Number.isNaN(sort)) {
            toast.error('填写标签与排序')
            return
          }
          patchPoolItem.mutate({
            value: editingPoolItem.value,
            label: poolEditState.label.trim(),
            enabled: poolEditState.enabled,
            sort
          })
        }}>
        {editingPoolItem ? (
          <>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Value: <span className="font-mono text-foreground">{editingPoolItem.value}</span>
              </p>
              <p>
                Key: <span className="font-mono text-foreground">{editingPoolItem.key}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label>标签</Label>
              <Input
                value={poolEditState.label}
                onChange={function (event) {
                  updatePoolEditState({ ...poolEditState, label: event.target.value })
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>排序</Label>
              <Input
                value={poolEditState.sort}
                onChange={function (event) {
                  updatePoolEditState({ ...poolEditState, sort: event.target.value })
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
              <Label>启用</Label>
              <Switch
                checked={poolEditState.enabled}
                onCheckedChange={function (checked) {
                  updatePoolEditState({ ...poolEditState, enabled: checked })
                }}
              />
            </div>
          </>
        ) : null}
      </EntitySheet>

      <EntitySheet
        open={allocateOpen}
        title="分配全局池条目"
        description="平台分配下一可用 value；key 为业务稳定标识。"
        submitLabel="分配"
        isPending={allocateItem.isPending}
        onOpenChange={updateAllocateOpen}
        onSubmit={function () {
          if (!allocateDraft.key.trim() || !allocateDraft.label.trim()) {
            toast.error('填写 key 与标签')
            return
          }
          const sort = allocateDraft.sort.trim() ? Number(allocateDraft.sort) : undefined
          if (allocateDraft.sort.trim() && Number.isNaN(sort)) {
            toast.error('排序需为数字')
            return
          }
          allocateItem.mutate({
            key: allocateDraft.key.trim(),
            label: allocateDraft.label.trim(),
            sort
          })
        }}>
        <div className="space-y-2">
          <Label>Key</Label>
          <Input
            className="font-mono"
            placeholder="例如 DRAFT"
            value={allocateDraft.key}
            onChange={function (event) {
              updateAllocateDraft({ ...allocateDraft, key: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>标签</Label>
          <Input
            value={allocateDraft.label}
            onChange={function (event) {
              updateAllocateDraft({ ...allocateDraft, label: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>排序（可选）</Label>
          <Input
            value={allocateDraft.sort}
            onChange={function (event) {
              updateAllocateDraft({ ...allocateDraft, sort: event.target.value })
            }}
          />
        </div>
      </EntitySheet>

      <EntitySheet
        open={typeCreateOpen}
        title="新建字典类型"
        submitLabel="创建"
        isPending={createType.isPending}
        onOpenChange={updateTypeCreateOpen}
        onSubmit={function () {
          if (!typeDraft.code.trim() || !typeDraft.name.trim()) {
            toast.error('填写 code 与名称')
            return
          }
          createType.mutate({
            code: typeDraft.code.trim(),
            name: typeDraft.name.trim(),
            description: typeDraft.description.trim() || null
          })
        }}>
        <div className="space-y-2">
          <Label>Code</Label>
          <Input
            className="font-mono"
            value={typeDraft.code}
            onChange={function (event) {
              updateTypeDraft({ ...typeDraft, code: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>名称</Label>
          <Input
            value={typeDraft.name}
            onChange={function (event) {
              updateTypeDraft({ ...typeDraft, name: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>说明（可选）</Label>
          <Input
            value={typeDraft.description}
            onChange={function (event) {
              updateTypeDraft({ ...typeDraft, description: event.target.value })
            }}
          />
        </div>
      </EntitySheet>

      <EntitySheet
        open={typeEditOpen}
        title="编辑字典类型"
        isPending={patchType.isPending}
        onOpenChange={updateTypeEditOpen}
        onSubmit={function () {
          if (!typeDraft.code || !typeDraft.name.trim()) {
            toast.error('填写名称')
            return
          }
          patchType.mutate({
            code: typeDraft.code,
            name: typeDraft.name.trim(),
            description: typeDraft.description.trim() || null
          })
        }}>
        <div className="space-y-1 text-sm text-muted-foreground">
          Code: <span className="font-mono text-foreground">{typeDraft.code}</span>
        </div>
        <div className="space-y-2">
          <Label>名称</Label>
          <Input
            value={typeDraft.name}
            onChange={function (event) {
              updateTypeDraft({ ...typeDraft, name: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>说明</Label>
          <Input
            value={typeDraft.description}
            onChange={function (event) {
              updateTypeDraft({ ...typeDraft, description: event.target.value })
            }}
          />
        </div>
      </EntitySheet>

      <EntitySheet
        open={claimOpen}
        title="认领池条目"
        description={
          selectedType
            ? `类型 ${selectedType.code}：可认领本类型尚未使用的池条目；已被其他类型认领的条目可直接复用。`
            : undefined
        }
        submitLabel="认领"
        isPending={claimItems.isPending}
        onOpenChange={updateClaimOpen}
        onSubmit={function () {
          if (!selectedTypeCode || !claimDraft.value) {
            toast.error('选择 value')
            return
          }
          const sort = Number(claimDraft.sort)
          if (Number.isNaN(sort)) {
            toast.error('排序需为数字')
            return
          }
          const claim: DictClaim = {
            value: claimDraft.value,
            isDefault: claimDraft.isDefault,
            sort
          }
          if (claimDraft.label.trim()) {
            claim.label = claimDraft.label.trim()
          }
          claimItems.mutate({ code: selectedTypeCode, claims: [claim] })
        }}>
        <div className="space-y-2">
          <Label>池 Value</Label>
          <Select
            value={claimDraft.value || null}
            onValueChange={function (value) {
              updateClaimDraft({ ...claimDraft, value })
            }}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="选择可认领条目（可复用）" />
            </SelectTrigger>
            <SelectContent>
              {claimableValues.map(function (row) {
                const others = (claimersByValue.get(row.value) ?? []).filter(function (code) {
                  return code !== selectedTypeCode
                })
                return (
                  <SelectItem key={row.value} value={row.value}>
                    {row.value} · {row.key} · {row.label}
                    {others.length > 0 ? ` · 已用于 ${others.join(', ')}` : ''}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>类型级标签（可选，留空用池默认）</Label>
          <Input
            value={claimDraft.label}
            onChange={function (event) {
              updateClaimDraft({ ...claimDraft, label: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>排序</Label>
          <Input
            value={claimDraft.sort}
            onChange={function (event) {
              updateClaimDraft({ ...claimDraft, sort: event.target.value })
            }}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <Label>设为默认项</Label>
          <Switch
            checked={claimDraft.isDefault}
            onCheckedChange={function (checked) {
              updateClaimDraft({ ...claimDraft, isDefault: checked })
            }}
          />
        </div>
      </EntitySheet>

      <EntitySheet
        open={claimEditOpen}
        title="编辑类型级条目"
        description="通过取消并重新认领更新类型级字段。"
        isPending={replaceClaim.isPending}
        onOpenChange={function (open) {
          updateClaimEditOpen(open)
          if (!open) updateEditingClaim(null)
        }}
        onSubmit={function () {
          if (!selectedTypeCode || !editingClaim) return
          const sort = Number(claimEditDraft.sort)
          if (Number.isNaN(sort)) {
            toast.error('排序需为数字')
            return
          }
          const claim: DictClaim = {
            value: editingClaim.value,
            isDefault: claimEditDraft.isDefault,
            sort,
            label: claimEditDraft.label.trim() || null
          }
          replaceClaim.mutate({
            code: selectedTypeCode,
            value: editingClaim.value,
            claim
          })
        }}>
        {editingClaim ? (
          <>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Value: <span className="font-mono text-foreground">{editingClaim.value}</span>
              </p>
              <p>
                Key: <span className="font-mono text-foreground">{editingClaim.key}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label>展示标签</Label>
              <Input
                value={claimEditDraft.label}
                onChange={function (event) {
                  updateClaimEditDraft({ ...claimEditDraft, label: event.target.value })
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>排序</Label>
              <Input
                value={claimEditDraft.sort}
                onChange={function (event) {
                  updateClaimEditDraft({ ...claimEditDraft, sort: event.target.value })
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
              <Label>默认项</Label>
              <Switch
                checked={claimEditDraft.isDefault}
                onCheckedChange={function (checked) {
                  updateClaimEditDraft({ ...claimEditDraft, isDefault: checked })
                }}
              />
            </div>
          </>
        ) : null}
      </EntitySheet>

      <EntitySheet
        open={tenantEditOpen}
        title="租户级覆盖"
        description="仅覆盖 label / enabled；留空 label 可清除自定义文案。"
        isPending={upsertTenant.isPending}
        onOpenChange={function (open) {
          updateTenantEditOpen(open)
          if (!open) updateEditingTenantRow(null)
        }}
        onSubmit={function () {
          if (!loadedTenantId || !editingTenantRow) return
          upsertTenant.mutate({
            tenantId: loadedTenantId,
            typeCode: editingTenantRow.typeCode,
            value: editingTenantRow.value,
            label: tenantEditDraft.label.trim() || null,
            enabled: tenantEditDraft.enabled
          })
        }}>
        {editingTenantRow ? (
          <>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                类型:{' '}
                <span className="font-mono text-foreground">{editingTenantRow.typeCode}</span>
              </p>
              <p>
                Value: <span className="font-mono text-foreground">{editingTenantRow.value}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label>覆盖标签</Label>
              <Input
                value={tenantEditDraft.label}
                onChange={function (event) {
                  updateTenantEditDraft({ ...tenantEditDraft, label: event.target.value })
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
              <Label>启用</Label>
              <Switch
                checked={tenantEditDraft.enabled}
                onCheckedChange={function (checked) {
                  updateTenantEditDraft({ ...tenantEditDraft, enabled: checked })
                }}
              />
            </div>
          </>
        ) : null}
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingUnclaim)}
        title="取消认领？"
        description="该 value 将不再出现在此类型的合并视图中。"
        confirmLabel="取消认领"
        destructive
        isPending={removeClaim.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingUnclaim(null)
        }}
        onConfirm={function () {
          if (!selectedTypeCode || !pendingUnclaim) return
          removeClaim.mutate({ code: selectedTypeCode, value: pendingUnclaim.value })
        }}
      />
    </ConsolePage>
  )
}
