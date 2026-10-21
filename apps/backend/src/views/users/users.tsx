import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import {
  NativeSelect,
  NativeSelectOption
} from '@i-thinking/design/components/native-select'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_USER,
  GET_USERS,
  POST_USER,
  PUT_USER,
  USER_ROLES,
  USER_STATUSES,
  type UserRecord
} from '@/apis/user.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
import { HttpError } from '@/utils/http/errors.ts'

type UserRole = (typeof USER_ROLES)[number]

function parseUserRole(value: string): UserRole {
  for (const role of USER_ROLES) {
    if (role === value) return role
  }
  return USER_ROLES[0]
}

export default function UsersView() {
  const queryClient = useQueryClient()
  const [keyword, updateKeyword] = useState('')
  const [draft, updateDraft] = useState<{
    username: string
    password: string
    role: UserRole
  }>({ username: '', password: '', role: USER_ROLES[0] })

  const users = useQuery({ queryKey: ['users'], queryFn: GET_USERS })

  const filtered = useMemo(
    function () {
      const needle = keyword.trim().toLowerCase()
      if (!needle) return users.data ?? []
      return (users.data ?? []).filter(function (user) {
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
      updateDraft({ username: '', password: '', role: USER_ROLES[0] })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const patchUser = useMutation({
    mutationFn: function (input: { id: string; role?: string; status?: string }) {
      return PUT_USER(input.id, { role: input.role, status: input.status })
    },
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
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
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  function renderRow(user: UserRecord) {
    return (
      <tr
        key={user.id}
        className="border-b border-border/70 text-sm">
        <td className="py-2.5 pr-3 font-medium">{user.username}</td>
        <td className="py-2.5 pr-3 text-muted-foreground">{user.email ?? '—'}</td>
        <td className="py-2.5 pr-3">
          <NativeSelect
            size="sm"
            aria-label={`${user.username} 角色`}
            value={user.role}
            onChange={function (event) {
              patchUser.mutate({ id: user.id, role: event.target.value })
            }}>
            {USER_ROLES.map(function (role) {
              return (
                <NativeSelectOption
                  key={role}
                  value={role}>
                  {role}
                </NativeSelectOption>
              )
            })}
          </NativeSelect>
        </td>
        <td className="py-2.5 pr-3">
          <NativeSelect
            size="sm"
            aria-label={`${user.username} 状态`}
            value={user.status}
            onChange={function (event) {
              patchUser.mutate({ id: user.id, status: event.target.value })
            }}>
            {USER_STATUSES.map(function (status) {
              return (
                <NativeSelectOption
                  key={status}
                  value={status}>
                  {status}
                </NativeSelectOption>
              )
            })}
          </NativeSelect>
        </td>
        <td className="py-2.5 text-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={function () {
              if (!window.confirm(`删除用户 ${user.username}？`)) return
              removeUser.mutate(user.id)
            }}>
            删除
          </Button>
        </td>
      </tr>
    )
  }

  return (
    <div>
      <PageHeader
        title="用户"
        description="平台账号 CRUD。角色与状态变更即时生效。"
      />

      <div className="mb-6 grid gap-3 rounded-xl border border-border/80 p-4 sm:grid-cols-4">
        <Input
          placeholder="用户名"
          value={draft.username}
          onChange={function (event) {
            updateDraft({ ...draft, username: event.target.value })
          }}
        />
        <Input
          placeholder="初始密码"
          type="password"
          value={draft.password}
          onChange={function (event) {
            updateDraft({ ...draft, password: event.target.value })
          }}
        />
        <NativeSelect
          className="w-full"
          aria-label="角色"
          value={draft.role}
          onChange={function (event) {
            updateDraft({ ...draft, role: parseUserRole(event.target.value) })
          }}>
          {USER_ROLES.map(function (role) {
            return (
              <NativeSelectOption
                key={role}
                value={role}>
                {role}
              </NativeSelectOption>
            )
          })}
        </NativeSelect>
        <Button
          disabled={createUser.isPending}
          onClick={function () {
            if (!draft.username || !draft.password) {
              toast.error('填写用户名与密码')
              return
            }
            createUser.mutate(draft)
          }}>
          创建
        </Button>
      </div>

      <Input
        className="mb-4 max-w-sm"
        placeholder="搜索用户名 / 邮箱 / 角色"
        value={keyword}
        onChange={function (event) {
          updateKeyword(event.target.value)
        }}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead className="text-xs tracking-wide text-muted-foreground uppercase">
            <tr className="border-b border-border">
              <th className="pb-2 font-medium">用户名</th>
              <th className="pb-2 font-medium">邮箱</th>
              <th className="pb-2 font-medium">角色</th>
              <th className="pb-2 font-medium">状态</th>
              <th className="pb-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.isLoading ? (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 text-center text-sm text-muted-foreground">
                  加载中…
                </td>
              </tr>
            ) : (
              filtered.map(renderRow)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
