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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  DELETE_USER,
  GET_USERS,
  GET_USER_TENANTS,
  POST_USER,
  PUT_USER,
  type UserRecord
} from '@/apis/user.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { FilterBar } from '@/components/console/filter-bar.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { StatusBadge } from '@/components/console/status-badge.tsx'
import { provisionPersonalTenant } from '@/features/tenant/provision-personal.ts'
import { useSessionStore } from '@/stores/session.ts'
import { HttpError } from '@/utils/http/errors.ts'

const ROLE_ITEMS = [
  { value: 'USER', label: 'USER' },
  { value: 'ADMIN', label: 'ADMIN' }
]

const STATUS_ITEMS = [
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'DISABLED', label: 'DISABLED' }
]

const GENDER_NONE = '__none__'
const GENDER_ITEMS = [
  { value: GENDER_NONE, label: '未设置' },
  { value: 'MALE', label: 'MALE' },
  { value: 'FEMALE', label: 'FEMALE' }
]

function stopRowClick(event: { stopPropagation(): void }) {
  event.stopPropagation()
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleString()
}

function shortID(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

export default function UsersView() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusID = searchParams.get('focus')
  const selfID = useSessionStore(function (state) {
    return state.user?.id
  })
  const [keyword, updateKeyword] = useState('')
  const [sheetOpen, updateSheetOpen] = useState(false)
  const [editing, updateEditing] = useState<UserRecord | null>(null)
  const [draft, updateDraft] = useState({
    username: '',
    password: '',
    role: 'USER',
    status: 'ACTIVE',
    email: '',
    phone: '',
    gender: GENDER_NONE,
    birthday: ''
  })
  const [pendingDelete, updatePendingDelete] = useState<UserRecord | null>(null)

  const users = useQuery({ queryKey: ['users'], queryFn: GET_USERS })

  const userTenants = useQuery({
    queryKey: ['user-tenants', editing?.id],
    queryFn: function () {
      return GET_USER_TENANTS(editing!.id)
    },
    enabled: Boolean(editing?.id) && sheetOpen
  })

  const filtered = useMemo(
    function () {
      const needle = keyword.trim().toLowerCase()
      const rows = users.data ?? []
      if (!needle) return rows
      return rows.filter(function (user) {
        return (
          user.username.toLowerCase().includes(needle) ||
          (user.email ?? '').toLowerCase().includes(needle) ||
          (user.phone ?? '').toLowerCase().includes(needle) ||
          user.id.toLowerCase().includes(needle) ||
          user.role.toLowerCase().includes(needle)
        )
      })
    },
    [keyword, users.data]
  )

  const createUser = useMutation({
    mutationFn: POST_USER,
    onSuccess() {
      toast.success('已创建用户')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      updateSheetOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const patchUser = useMutation({
    mutationFn: function (input: {
      id: string
      role?: string
      status?: string
      password?: string
      email?: string | null
      phone?: string | null
      gender?: string | null
      birthday?: string | null
      username?: string
    }) {
      return PUT_USER(input.id, {
        role: input.role,
        status: input.status,
        password: input.password || undefined,
        email: input.email,
        phone: input.phone,
        gender: input.gender,
        birthday: input.birthday,
        username: input.username
      })
    },
    onSuccess() {
      toast.success('已更新')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['user-tenants'] })
      updateSheetOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const removeUser = useMutation({
    mutationFn: DELETE_USER,
    onSuccess() {
      toast.success('已删除')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      updatePendingDelete(null)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const grantFreeQuota = useMutation({
    mutationFn: function (user: UserRecord) {
      return provisionPersonalTenant({ userID: user.id, username: user.username })
    },
    onSuccess(result) {
      const tenantID = result.tenant.id
      toast.success(
        result.alreadyHad ? '该用户已有个人租户（免费配额）' : '已开通个人租户，可使用免费配额',
        {
          action: {
            label: '查看租户',
            onClick() {
              navigate(`/tenants?focus=${tenantID}`)
            }
          }
        }
      )
      void queryClient.invalidateQueries({ queryKey: ['user-tenants'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  function openCreate() {
    updateEditing(null)
    updateDraft({
      username: '',
      password: '',
      role: 'USER',
      status: 'ACTIVE',
      email: '',
      phone: '',
      gender: GENDER_NONE,
      birthday: ''
    })
    updateSheetOpen(true)
  }

  function openEdit(user: UserRecord) {
    updateEditing(user)
    updateDraft({
      username: user.username,
      password: '',
      role: user.role,
      status: user.status,
      email: user.email ?? '',
      phone: user.phone ?? '',
      gender: user.gender ?? GENDER_NONE,
      birthday: user.birthday ?? ''
    })
    updateSheetOpen(true)
  }

  return (
    <ConsolePage
      actions={
        <Button
          size="lg"
          className="h-10 px-4"
          onClick={openCreate}>
          新建用户
        </Button>
      }
      toolbar={
        <FilterBar
          search={keyword}
          searchPlaceholder="搜索用户名 / 邮箱 / 手机 / ID / 角色"
          onSearchChange={updateKeyword}
        />
      }>
      <QueryState
        isLoading={users.isLoading}
        isError={users.isError}
        error={users.error}
        onRetry={function () {
          void users.refetch()
        }}>
        <DataTable
          columns={[
            {
              key: 'username',
              title: '用户名',
              render(row) {
                return (
                  <div>
                    <span
                      className={
                        row.id === focusID ? 'font-semibold text-foreground' : 'font-medium'
                      }>
                      {row.username}
                    </span>
                    <div
                      className="font-mono text-xs text-muted-foreground"
                      title={row.id}>
                      {shortID(row.id)}
                    </div>
                  </div>
                )
              }
            },
            {
              key: 'email',
              title: '邮箱',
              className: 'text-muted-foreground',
              render(row) {
                return row.email ?? '—'
              }
            },
            {
              key: 'phone',
              title: '手机',
              className: 'text-muted-foreground',
              render(row) {
                return row.phone ?? '—'
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
                      if (value === null || value === undefined) return
                      if (row.id === selfID && value !== 'ADMIN') {
                        toast.error('不能降低自己的管理员角色')
                        return
                      }
                      patchUser.mutate({ id: row.id, role: value })
                    }}>
                    <SelectTrigger
                      className="h-9 w-[8rem]"
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
                    disabled={row.id === selfID}
                    onValueChange={function (value) {
                      if (value === null || value === undefined) return
                      patchUser.mutate({ id: row.id, status: value })
                    }}>
                    <SelectTrigger
                      className="h-9 w-[8rem]"
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
                      disabled={row.id === selfID}
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
          rows={filtered}
          rowKey={function (row) {
            return row.id
          }}
          emptyTitle="暂无用户"
          emptyActionLabel="新建用户"
          onEmptyAction={openCreate}
          onRowClick={openEdit}
        />
      </QueryState>

      <EntitySheet
        open={sheetOpen}
        title={editing ? `编辑 ${editing.username}` : '新建用户'}
        description={
          editing
            ? '可改资料、重置密码、调整角色与状态。停用账号不会自动移除租户成员关系。'
            : '创建后立即生效。'
        }
        contentClassName="sm:max-w-lg"
        submitLabel={editing ? '保存' : '创建'}
        isPending={createUser.isPending || patchUser.isPending}
        onOpenChange={updateSheetOpen}
        onSubmit={function () {
          if (editing) {
            patchUser.mutate({
              id: editing.id,
              username: draft.username.trim() || undefined,
              role: draft.role,
              status: draft.status,
              password: draft.password || undefined,
              email: draft.email.trim() || null,
              phone: draft.phone.trim() || null,
              gender: draft.gender === GENDER_NONE ? null : draft.gender,
              birthday: draft.birthday.trim() || null
            })
            return
          }
          if (!draft.username || !draft.password) {
            toast.error('填写用户名与密码')
            return
          }
          createUser.mutate({
            username: draft.username,
            password: draft.password,
            role: draft.role
          })
        }}>
        <div className="space-y-2">
          <Label>用户名</Label>
          <Input
            value={draft.username}
            onChange={function (event) {
              updateDraft({ ...draft, username: event.target.value })
            }}
          />
        </div>
        {editing ? (
          <div className="space-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <div>
              ID{' '}
              <span className="font-mono text-foreground">{editing.id}</span>
            </div>
            <div>创建 {formatTime(editing.createdAt)}</div>
            <div>更新 {formatTime(editing.updatedAt)}</div>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label>{editing ? '新密码（可选）' : '初始密码'}</Label>
          <Input
            type="password"
            value={draft.password}
            onChange={function (event) {
              updateDraft({ ...draft, password: event.target.value })
            }}
          />
        </div>
        {editing ? (
          <>
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input
                value={draft.email}
                onChange={function (event) {
                  updateDraft({ ...draft, email: event.target.value })
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>手机</Label>
              <Input
                value={draft.phone}
                onChange={function (event) {
                  updateDraft({ ...draft, phone: event.target.value })
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>性别</Label>
                <Select
                  items={GENDER_ITEMS}
                  value={draft.gender}
                  onValueChange={function (value) {
                    updateDraft({ ...draft, gender: value ?? GENDER_NONE })
                  }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="未设置" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_ITEMS.map(function (item) {
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
              <div className="space-y-2">
                <Label>生日</Label>
                <Input
                  placeholder="YYYY-MM-DD"
                  value={draft.birthday}
                  onChange={function (event) {
                    updateDraft({ ...draft, birthday: event.target.value })
                  }}
                />
              </div>
            </div>
          </>
        ) : null}
        <div className="space-y-2">
          <Label>角色</Label>
          <Select
            items={ROLE_ITEMS}
            value={draft.role}
            onValueChange={function (value) {
              if (value) updateDraft({ ...draft, role: value })
            }}>
            <SelectTrigger className="w-full">
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

        {editing ? (
          <div className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label>所属租户</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  免费配额挂在 PERSONAL 个人租户上；无则点击右侧开通。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={grantFreeQuota.isPending}
                onClick={function () {
                  grantFreeQuota.mutate(editing)
                }}>
                {grantFreeQuota.isPending ? '开通中…' : '开通免费配额'}
              </Button>
            </div>
            {userTenants.isLoading ? (
              <p className="text-sm text-muted-foreground">加载中…</p>
            ) : userTenants.isError ? (
              <p className="text-sm text-destructive">无法加载所属租户</p>
            ) : (userTenants.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">未加入任何租户</p>
            ) : (
              <ul className="space-y-2">
                {(userTenants.data ?? []).map(function (tenant) {
                  return (
                    <li
                      key={tenant.tenantID}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                      <div>
                        <Link
                          className="font-medium underline-offset-2 hover:underline"
                          to={`/tenants?focus=${tenant.tenantID}`}>
                          {tenant.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {tenant.slug} · {tenant.type} · {tenant.role}
                          {String(tenant.type).toUpperCase() === 'PERSONAL' ? ' · 免费/订阅档' : ''}
                        </div>
                      </div>
                      <StatusBadge status={tenant.memberStatus} />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : null}
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`删除用户 ${pendingDelete?.username ?? ''}？`}
        description="此操作不可撤销。该用户的租户成员关系将一并删除（CASCADE）。若仍有活跃会话，将在下次请求时失效。"
        confirmLabel="删除"
        destructive
        isPending={removeUser.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingDelete(null)
        }}
        onConfirm={function () {
          if (!pendingDelete) return
          if (pendingDelete.id === selfID) {
            toast.error('不能删除自己')
            return
          }
          removeUser.mutate(pendingDelete.id)
        }}
      />
    </ConsolePage>
  )
}
