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
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { DELETE_USER, GET_USERS, POST_USER, PUT_USER, type UserRecord } from '@/apis/user.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { FilterBar } from '@/components/console/filter-bar.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
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

function stopRowClick(event: { stopPropagation(): void }) {
  event.stopPropagation()
}

export default function UsersView() {
  const queryClient = useQueryClient()
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
    status: 'ACTIVE'
  })
  const [pendingDelete, updatePendingDelete] = useState<UserRecord | null>(null)

  const users = useQuery({ queryKey: ['users'], queryFn: GET_USERS })

  const filtered = useMemo(
    function () {
      const needle = keyword.trim().toLowerCase()
      const rows = users.data ?? []
      if (!needle) return rows
      return rows.filter(function (user) {
        return (
          user.username.toLowerCase().includes(needle) ||
          (user.email ?? '').toLowerCase().includes(needle) ||
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
    mutationFn: function (input: { id: string; role?: string; status?: string; password?: string }) {
      return PUT_USER(input.id, {
        role: input.role,
        status: input.status,
        password: input.password || undefined
      })
    },
    onSuccess() {
      toast.success('已更新')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
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

  function openCreate() {
    updateEditing(null)
    updateDraft({ username: '', password: '', role: 'USER', status: 'ACTIVE' })
    updateSheetOpen(true)
  }

  function openEdit(user: UserRecord) {
    updateEditing(user)
    updateDraft({
      username: user.username,
      password: '',
      role: user.role,
      status: user.status
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
          searchPlaceholder="搜索用户名 / 邮箱 / 角色"
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
                  <span
                    className={row.id === focusID ? 'font-semibold text-foreground' : 'font-medium'}>
                    {row.username}
                  </span>
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
              key: 'role',
              title: '角色',
              render(row) {
                return (
                  <Select
                    items={ROLE_ITEMS}
                    value={row.role}
                    onValueChange={function (value) {
                      if (value == null) return
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
                      if (value == null) return
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
        description={editing ? '可重置密码、调整角色与状态。' : '创建后立即生效。'}
        submitLabel={editing ? '保存' : '创建'}
        isPending={createUser.isPending || patchUser.isPending}
        onOpenChange={updateSheetOpen}
        onSubmit={function () {
          if (editing) {
            patchUser.mutate({
              id: editing.id,
              role: draft.role,
              status: draft.status,
              password: draft.password || undefined
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
        {!editing ? (
          <div className="space-y-2">
            <Label>用户名</Label>
            <Input
              value={draft.username}
              onChange={function (event) {
                updateDraft({ ...draft, username: event.target.value })
              }}
            />
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
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`删除用户 ${pendingDelete?.username ?? ''}？`}
        description="此操作不可撤销。若该用户仍有活跃会话，将在下次请求时失效。"
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
