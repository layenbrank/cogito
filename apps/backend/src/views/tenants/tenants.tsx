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
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  DELETE_ADMIN_TENANT,
  DELETE_ADMIN_TENANT_MEMBER,
  GET_ADMIN_TENANT,
  GET_ADMIN_TENANTS,
  POST_ADMIN_TENANT,
  POST_ADMIN_TENANT_MEMBER,
  POST_ADMIN_TENANT_SUBSCRIPTION,
  PUT_ADMIN_TENANT,
  PUT_ADMIN_TENANT_MEMBER,
  type TenantSummary
} from '@/apis/tenant.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { FilterBar } from '@/components/console/filter-bar.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { StatusBadge } from '@/components/console/status-badge.tsx'
import { HttpError } from '@/utils/http/errors.ts'

const TYPE_ITEMS = [
  { value: 'PERSONAL', label: 'PERSONAL' },
  { value: 'TEAM', label: 'TEAM' }
]

const STATUS_ITEMS = [
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'DISABLED', label: 'DISABLED' }
]

const ROLE_ITEMS = [
  { value: 'OWNER', label: 'OWNER' },
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'MEMBER', label: 'MEMBER' }
]

const PAGE_SIZE = 50
const FILTER_ALL = '__all__'

function stopRowClick(event: { stopPropagation(): void }) {
  event.stopPropagation()
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleString()
}

export default function TenantsView() {
  const queryClient = useQueryClient()
  const [searchParams, updateSearchParams] = useSearchParams()
  const focus = searchParams.get('focus')

  const [keyword, updateKeyword] = useState('')
  const [typeFilter, updateTypeFilter] = useState(FILTER_ALL)
  const [statusFilter, updateStatusFilter] = useState(FILTER_ALL)
  const [page, updatePage] = useState(1)
  const [selectedID, updateSelectedID] = useState<string | null>(focus)
  const [sheetOpen, updateSheetOpen] = useState(false)
  const [editing, updateEditing] = useState<TenantSummary | null>(null)
  const [draft, updateDraft] = useState({
    name: '',
    slug: '',
    type: 'TEAM',
    status: 'ACTIVE'
  })
  const [memberDraft, updateMemberDraft] = useState({ userID: '', role: 'MEMBER' })
  const [planDraft, updatePlanDraft] = useState('')
  const [pendingDelete, updatePendingDelete] = useState<TenantSummary | null>(null)
  const [pendingMemberRemove, updatePendingMemberRemove] = useState<string | null>(null)

  useEffect(
    function () {
      if (focus) updateSelectedID(focus)
    },
    [focus]
  )

  const tenants = useQuery({
    queryKey: ['admin-tenants', keyword, typeFilter, statusFilter, page],
    queryFn: function () {
      return GET_ADMIN_TENANTS({
        q: keyword.trim() || undefined,
        type: typeFilter === FILTER_ALL ? undefined : typeFilter,
        status: statusFilter === FILTER_ALL ? undefined : statusFilter,
        page,
        size: PAGE_SIZE
      })
    }
  })

  const detail = useQuery({
    queryKey: ['admin-tenant', selectedID],
    queryFn: function () {
      return GET_ADMIN_TENANT(selectedID!)
    },
    enabled: Boolean(selectedID)
  })

  function invalidateTenants() {
    void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-tenant'] })
  }

  const createTenant = useMutation({
    mutationFn: POST_ADMIN_TENANT,
    onSuccess() {
      toast.success('已创建租户')
      invalidateTenants()
      updateSheetOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const patchTenant = useMutation({
    mutationFn: function (input: {
      id: string
      name?: string
      status?: string
      type?: string
    }) {
      return PUT_ADMIN_TENANT(input.id, {
        name: input.name,
        status: input.status,
        type: input.type
      })
    },
    onSuccess() {
      toast.success('已更新租户')
      invalidateTenants()
      updateSheetOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const removeTenant = useMutation({
    mutationFn: DELETE_ADMIN_TENANT,
    onSuccess() {
      toast.success('已删除租户')
      if (pendingDelete?.id === selectedID) {
        updateSelectedID(null)
        updateSearchParams(function (prev) {
          prev.delete('focus')
          return prev
        })
      }
      updatePendingDelete(null)
      invalidateTenants()
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const addMember = useMutation({
    mutationFn: function (input: { tenantID: string; userID: string; role: string }) {
      return POST_ADMIN_TENANT_MEMBER(input.tenantID, {
        userID: input.userID,
        role: input.role
      })
    },
    onSuccess() {
      toast.success('已添加成员')
      updateMemberDraft({ userID: '', role: 'MEMBER' })
      invalidateTenants()
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const patchMember = useMutation({
    mutationFn: function (input: {
      tenantID: string
      userID: string
      role?: string
      status?: string
    }) {
      return PUT_ADMIN_TENANT_MEMBER(input.tenantID, input.userID, {
        role: input.role,
        status: input.status
      })
    },
    onSuccess() {
      toast.success('已更新成员')
      invalidateTenants()
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const removeMember = useMutation({
    mutationFn: function (input: { tenantID: string; userID: string }) {
      return DELETE_ADMIN_TENANT_MEMBER(input.tenantID, input.userID)
    },
    onSuccess() {
      toast.success('已移除成员')
      updatePendingMemberRemove(null)
      invalidateTenants()
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const grantSubscription = useMutation({
    mutationFn: function (input: { tenantID: string; plan: string }) {
      return POST_ADMIN_TENANT_SUBSCRIPTION(input.tenantID, { plan: input.plan })
    },
    onSuccess() {
      toast.success('已开通 / 续订')
      updatePlanDraft('')
      invalidateTenants()
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  function openCreate() {
    updateEditing(null)
    updateDraft({ name: '', slug: '', type: 'TEAM', status: 'ACTIVE' })
    updateSheetOpen(true)
  }

  function openEdit(row: TenantSummary) {
    updateEditing(row)
    updateDraft({
      name: row.name,
      slug: row.slug,
      type: row.type,
      status: row.status
    })
    updateSheetOpen(true)
  }

  function selectTenant(id: string) {
    updateSelectedID(id)
    updateSearchParams(function (prev) {
      prev.set('focus', id)
      return prev
    })
  }

  const pageData = tenants.data
  const rows = pageData?.items ?? []

  return (
    <ConsolePage
      actions={
        <Button
          size="lg"
          className="h-10 px-4"
          onClick={openCreate}>
          新建租户
        </Button>
      }
      toolbar={
        <div className="flex flex-wrap items-end gap-3">
          <FilterBar
            search={keyword}
            searchPlaceholder="搜索名称 / slug"
            onSearchChange={function (value) {
              updateKeyword(value)
              updatePage(1)
            }}
          />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">类型</Label>
            <Select
              items={[{ value: FILTER_ALL, label: '全部' }, ...TYPE_ITEMS]}
              value={typeFilter}
              onValueChange={function (value) {
                updateTypeFilter(value ?? FILTER_ALL)
                updatePage(1)
              }}>
              <SelectTrigger className="h-9 w-[8rem]">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>全部</SelectItem>
                {TYPE_ITEMS.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">状态</Label>
            <Select
              items={[{ value: FILTER_ALL, label: '全部' }, ...STATUS_ITEMS]}
              value={statusFilter}
              onValueChange={function (value) {
                updateStatusFilter(value ?? FILTER_ALL)
                updatePage(1)
              }}>
              <SelectTrigger className="h-9 w-[8rem]">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>全部</SelectItem>
                {STATUS_ITEMS.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
      }>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div
          className="overflow-hidden rounded-xl border border-border/80 bg-[var(--backend-surface)]"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          <QueryState
            isLoading={tenants.isLoading}
            isError={tenants.isError}
            error={tenants.error}
            onRetry={function () {
              void tenants.refetch()
            }}>
            <DataTable
              columns={[
                {
                  key: 'name',
                  title: '名称',
                  render(row) {
                    return (
                      <div>
                        <div
                          className={
                            row.id === selectedID
                              ? 'font-semibold text-foreground'
                              : 'font-medium'
                          }>
                          {row.name}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{row.slug}</div>
                      </div>
                    )
                  }
                },
                {
                  key: 'type',
                  title: '类型',
                  className: 'text-muted-foreground',
                  render(row) {
                    return row.type
                  }
                },
                {
                  key: 'members',
                  title: '成员',
                  render(row) {
                    return row.memberCount
                  }
                },
                {
                  key: 'status',
                  title: '状态',
                  render(row) {
                    return <StatusBadge status={row.status} />
                  }
                },
                {
                  key: 'created',
                  title: '创建',
                  className: 'text-xs text-muted-foreground',
                  render(row) {
                    return formatTime(row.createdAt)
                  }
                },
                {
                  key: 'actions',
                  title: '操作',
                  headerClassName: 'text-right',
                  className: 'text-right',
                  render(row) {
                    return (
                      <div
                        className="flex justify-end gap-1.5"
                        onClick={stopRowClick}>
                        <Button
                          variant="outline"
                          onClick={function () {
                            openEdit(row)
                          }}>
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={function () {
                            updatePendingDelete(row)
                          }}>
                          删除
                        </Button>
                      </div>
                    )
                  }
                }
              ]}
              rows={rows}
              rowKey={function (row) {
                return row.id
              }}
              emptyTitle="暂无租户"
              emptyActionLabel="新建租户"
              onEmptyAction={openCreate}
              onRowClick={function (row) {
                selectTenant(row.id)
              }}
            />
          </QueryState>
          {pageData && pageData.total > 1 ? (
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                共 {pageData.count} 条 · 第 {pageData.page}/{pageData.total} 页
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={!pageData.prev}
                  onClick={function () {
                    updatePage(function (current) {
                      return Math.max(1, current - 1)
                    })
                  }}>
                  上一页
                </Button>
                <Button
                  variant="outline"
                  disabled={!pageData.next}
                  onClick={function () {
                    updatePage(function (current) {
                      return current + 1
                    })
                  }}>
                  下一页
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div
          className="space-y-4 rounded-xl border border-border/80 bg-[var(--backend-surface)] p-4"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          {!selectedID ? (
            <p className="text-sm text-muted-foreground">选择左侧租户查看详情</p>
          ) : (
            <QueryState
              isLoading={detail.isLoading}
              isError={detail.isError}
              error={detail.error}
              skeletonRows={6}
              onRetry={function () {
                void detail.refetch()
              }}>
              {detail.data ? (
                <>
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold">{detail.data.name}</h3>
                    <p className="font-mono text-xs text-muted-foreground">
                      {detail.data.slug} · {detail.data.id}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                      <StatusBadge status={detail.data.status} />
                      <span>{detail.data.type}</span>
                      <span>成员 {detail.data.memberCount}</span>
                      <span>创建 {formatTime(detail.data.createdAt)}</span>
                    </div>
                  </div>

                  <section className="space-y-2">
                    <h4 className="text-sm font-medium">配额</h4>
                    {detail.data.quota ? (
                      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm">
                        <div>
                          来源 {detail.data.quota.source}
                          {detail.data.quota.plan ? ` · ${detail.data.quota.plan}` : ''}
                        </div>
                        <div className="text-muted-foreground">
                          日 Token 配额 {detail.data.quota.dailyTokenQuota.toLocaleString()}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">暂无配额快照</p>
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">订阅历史</h4>
                    </div>
                    <DataTable
                      columns={[
                        {
                          key: 'plan',
                          title: '档位',
                          render(row) {
                            return row.plan
                          }
                        },
                        {
                          key: 'status',
                          title: '状态',
                          render(row) {
                            return <StatusBadge status={row.status} />
                          }
                        },
                        {
                          key: 'created',
                          title: '创建',
                          className: 'text-xs text-muted-foreground',
                          render(row) {
                            return formatTime(row.createdAt)
                          }
                        }
                      ]}
                      rows={detail.data.subscriptions}
                      rowKey={function (row) {
                        return row.id
                      }}
                      emptyTitle="无订阅记录"
                    />
                    {detail.data.type === 'PERSONAL' ? (
                      <div className="flex gap-2">
                        <Input
                          placeholder="档位名（如 PRO）"
                          value={planDraft}
                          onChange={function (event) {
                            updatePlanDraft(event.target.value)
                          }}
                        />
                        <Button
                          disabled={!planDraft.trim() || grantSubscription.isPending}
                          onClick={function () {
                            grantSubscription.mutate({
                              tenantID: detail.data!.id,
                              plan: planDraft.trim()
                            })
                          }}>
                          代开
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        TEAM 租户走全局配额，不可订阅。
                      </p>
                    )}
                  </section>

                  <section className="space-y-2">
                    <h4 className="text-sm font-medium">成员</h4>
                    <DataTable
                      columns={[
                        {
                          key: 'user',
                          title: '用户',
                          render(row) {
                            return (
                              <div>
                                <Link
                                  className="font-medium text-foreground underline-offset-2 hover:underline"
                                  to={`/users?focus=${row.userID}`}
                                  onClick={stopRowClick}>
                                  {row.username ?? row.userID}
                                </Link>
                                {row.email ? (
                                  <div className="text-xs text-muted-foreground">{row.email}</div>
                                ) : null}
                              </div>
                            )
                          }
                        },
                        {
                          key: 'role',
                          title: '角色',
                          render(row) {
                            return (
                              <Select
                                items={ROLE_ITEMS}
                                value={row.role}
                                onValueChange={function (value) {
                                  if (!value) return
                                  patchMember.mutate({
                                    tenantID: detail.data!.id,
                                    userID: row.userID,
                                    role: value
                                  })
                                }}>
                                <SelectTrigger
                                  className="h-8 w-[7.5rem]"
                                  onClick={stopRowClick}
                                  onPointerDown={stopRowClick}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLE_ITEMS.map(function (item) {
                                    return (
                                      <SelectItem
                                        key={item.value}
                                        value={item.value}>
                                        {item.label}
                                      </SelectItem>
                                    )
                                  })}
                                </SelectContent>
                              </Select>
                            )
                          }
                        },
                        {
                          key: 'status',
                          title: '状态',
                          render(row) {
                            return (
                              <Select
                                items={STATUS_ITEMS}
                                value={row.status}
                                onValueChange={function (value) {
                                  if (!value) return
                                  patchMember.mutate({
                                    tenantID: detail.data!.id,
                                    userID: row.userID,
                                    status: value
                                  })
                                }}>
                                <SelectTrigger
                                  className="h-8 w-[7.5rem]"
                                  onClick={stopRowClick}
                                  onPointerDown={stopRowClick}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STATUS_ITEMS.map(function (item) {
                                    return (
                                      <SelectItem
                                        key={item.value}
                                        value={item.value}>
                                        {item.label}
                                      </SelectItem>
                                    )
                                  })}
                                </SelectContent>
                              </Select>
                            )
                          }
                        },
                        {
                          key: 'actions',
                          title: '',
                          className: 'text-right',
                          render(row) {
                            return (
                              <Button
                                variant="ghost"
                                className="text-destructive"
                                onClick={function (event) {
                                  stopRowClick(event)
                                  updatePendingMemberRemove(row.userID)
                                }}>
                                移除
                              </Button>
                            )
                          }
                        }
                      ]}
                      rows={detail.data.members}
                      rowKey={function (row) {
                        return row.userID
                      }}
                      emptyTitle="无成员"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="min-w-[12rem] flex-1"
                        placeholder="用户 UUID"
                        value={memberDraft.userID}
                        onChange={function (event) {
                          updateMemberDraft({ ...memberDraft, userID: event.target.value })
                        }}
                      />
                      <Select
                        items={ROLE_ITEMS}
                        value={memberDraft.role}
                        onValueChange={function (value) {
                          if (value) updateMemberDraft({ ...memberDraft, role: value })
                        }}>
                        <SelectTrigger className="h-9 w-[8rem]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_ITEMS.map(function (item) {
                            return (
                              <SelectItem
                                key={item.value}
                                value={item.value}>
                                {item.label}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                      <Button
                        disabled={!memberDraft.userID.trim() || addMember.isPending}
                        onClick={function () {
                          addMember.mutate({
                            tenantID: detail.data!.id,
                            userID: memberDraft.userID.trim(),
                            role: memberDraft.role
                          })
                        }}>
                        添加
                      </Button>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h4 className="text-sm font-medium">近期审计</h4>
                    <DataTable
                      columns={[
                        {
                          key: 'action',
                          title: '动作',
                          render(row) {
                            return row.action
                          }
                        },
                        {
                          key: 'resource',
                          title: '资源',
                          className: 'font-mono text-xs',
                          render(row) {
                            return row.resource
                          }
                        },
                        {
                          key: 'at',
                          title: '时间',
                          className: 'text-xs text-muted-foreground',
                          render(row) {
                            return formatTime(row.createdAt)
                          }
                        }
                      ]}
                      rows={detail.data.recentAudit}
                      rowKey={function (row) {
                        return row.id
                      }}
                      emptyTitle="暂无审计"
                    />
                  </section>
                </>
              ) : null}
            </QueryState>
          )}
        </div>
      </div>

      <EntitySheet
        open={sheetOpen}
        title={editing ? `编辑 ${editing.name}` : '新建租户'}
        description={
          editing
            ? '可改名称、类型与状态。slug 创建后不可改。'
            : '建议创建 TEAM；PERSONAL 走免费/订阅配额。'
        }
        submitLabel={editing ? '保存' : '创建'}
        isPending={createTenant.isPending || patchTenant.isPending}
        onOpenChange={updateSheetOpen}
        onSubmit={function () {
          if (editing) {
            patchTenant.mutate({
              id: editing.id,
              name: draft.name.trim() || undefined,
              status: draft.status,
              type: draft.type
            })
            return
          }
          if (!draft.name.trim() || !draft.slug.trim()) {
            toast.error('填写名称与 slug')
            return
          }
          createTenant.mutate({
            name: draft.name.trim(),
            slug: draft.slug.trim(),
            type: draft.type
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
        {!editing ? (
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input
              value={draft.slug}
              placeholder="小写字母 / 数字 / 中划线"
              onChange={function (event) {
                updateDraft({ ...draft, slug: event.target.value })
              }}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input
              value={draft.slug}
              disabled
            />
          </div>
        )}
        <div className="space-y-2">
          <Label>类型</Label>
          <Select
            items={TYPE_ITEMS}
            value={draft.type}
            onValueChange={function (value) {
              if (value) updateDraft({ ...draft, type: value })
            }}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_ITEMS.map(function (item) {
                return (
                  <SelectItem
                    key={item.value}
                    value={item.value}>
                    {item.label}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        {editing ? (
          <div className="space-y-2">
            <Label>状态</Label>
            <Select
              items={STATUS_ITEMS}
              value={draft.status}
              onValueChange={function (value) {
                if (value) updateDraft({ ...draft, status: value })
              }}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ITEMS.map(function (item) {
                  return (
                    <SelectItem
                      key={item.value}
                      value={item.value}>
                      {item.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`删除租户 ${pendingDelete?.name ?? ''}？`}
        description="成员关系将一并删除，且不可撤销。"
        confirmLabel="删除"
        destructive
        isPending={removeTenant.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingDelete(null)
        }}
        onConfirm={function () {
          if (!pendingDelete) return
          removeTenant.mutate(pendingDelete.id)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingMemberRemove)}
        title="移除该成员？"
        description="仅解除租户成员关系，不会删除用户账号。"
        confirmLabel="移除"
        destructive
        isPending={removeMember.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingMemberRemove(null)
        }}
        onConfirm={function () {
          if (!selectedID || !pendingMemberRemove) return
          removeMember.mutate({ tenantID: selectedID, userID: pendingMemberRemove })
        }}
      />
    </ConsolePage>
  )
}
