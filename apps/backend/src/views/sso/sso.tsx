import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  DELETE_SSO_CONNECTION,
  GET_SSO_CONNECTIONS,
  POST_SSO_CONNECTION,
  PUT_SSO_CONNECTION,
  type SsoConnection
} from '@/apis/sso.ts'
import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { DataTable } from '@/components/console/data-table.tsx'
import { EntitySheet } from '@/components/console/entity-sheet.tsx'
import { QueryState } from '@/components/console/query-state.tsx'
import { StatusBadge } from '@/components/console/status-badge.tsx'
import { HttpError } from '@/utils/http/errors.ts'

export default function SsoView() {
  const queryClient = useQueryClient()
  const connections = useQuery({ queryKey: ['sso-connections'], queryFn: GET_SSO_CONNECTIONS })
  const [sheetOpen, updateSheetOpen] = useState(false)
  const [editing, updateEditing] = useState<SsoConnection | null>(null)
  const [pendingDelete, updatePendingDelete] = useState<SsoConnection | null>(null)
  const [draft, updateDraft] = useState({
    tenantID: '',
    provider: 'oidc',
    issuer: '',
    clientID: '',
    clientSecret: '',
    redirectUri: '',
    status: 'ACTIVE'
  })

  const createConnection = useMutation({
    mutationFn: POST_SSO_CONNECTION,
    onSuccess() {
      toast.success('已创建连接')
      void queryClient.invalidateQueries({ queryKey: ['sso-connections'] })
      updateSheetOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const patchConnection = useMutation({
    mutationFn: function (input: {
      id: string
      issuer?: string
      clientID?: string
      clientSecret?: string
      redirectUri?: string
      status?: string
    }) {
      return PUT_SSO_CONNECTION(input.id, input)
    },
    onSuccess() {
      toast.success('已更新')
      void queryClient.invalidateQueries({ queryKey: ['sso-connections'] })
      updateSheetOpen(false)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  const removeConnection = useMutation({
    mutationFn: DELETE_SSO_CONNECTION,
    onSuccess() {
      toast.success('已删除连接')
      void queryClient.invalidateQueries({ queryKey: ['sso-connections'] })
      updatePendingDelete(null)
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  function openCreate() {
    updateEditing(null)
    updateDraft({
      tenantID: '',
      provider: 'oidc',
      issuer: '',
      clientID: '',
      clientSecret: '',
      redirectUri: '',
      status: 'ACTIVE'
    })
    updateSheetOpen(true)
  }

  function openEdit(row: SsoConnection) {
    updateEditing(row)
    updateDraft({
      tenantID: row.tenantID,
      provider: row.provider,
      issuer: row.issuer,
      clientID: row.clientID,
      clientSecret: '',
      redirectUri: row.redirectUri,
      status: row.status
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
          新建连接
        </Button>
      }>
      <QueryState
        isLoading={connections.isLoading}
        isError={connections.isError}
        error={connections.error}
        onRetry={function () {
          void connections.refetch()
        }}>
        <DataTable
          columns={[
            {
              key: 'provider',
              title: 'Provider',
              render(row) {
                return <span className="font-medium">{row.provider}</span>
              }
            },
            {
              key: 'tenant',
              title: '租户',
              className: 'font-mono text-xs',
              render(row) {
                return row.tenantID
              }
            },
            {
              key: 'issuer',
              title: 'Issuer',
              className: 'max-w-xs truncate text-xs text-muted-foreground',
              render(row) {
                return row.issuer
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
              key: 'actions',
              title: '操作',
              headerClassName: 'text-right',
              className: 'text-right',
              render(row) {
                return (
                  <div className="flex justify-end gap-1.5">
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
          rows={connections.data ?? []}
          rowKey={function (row) {
            return row.id
          }}
          emptyTitle="暂无连接"
          emptyActionLabel="新建连接"
          onEmptyAction={openCreate}
        />
      </QueryState>

      <EntitySheet
        open={sheetOpen}
        title={editing ? '编辑 SSO 连接' : '新建 SSO 连接'}
        description="secret 留空表示不修改。"
        submitLabel={editing ? '保存' : '创建'}
        isPending={createConnection.isPending || patchConnection.isPending}
        onOpenChange={updateSheetOpen}
        onSubmit={function () {
          if (editing) {
            patchConnection.mutate({
              id: editing.id,
              issuer: draft.issuer,
              clientID: draft.clientID,
              clientSecret: draft.clientSecret || undefined,
              redirectUri: draft.redirectUri,
              status: draft.status
            })
            return
          }
          if (
            !draft.tenantID ||
            !draft.issuer ||
            !draft.clientID ||
            !draft.clientSecret ||
            !draft.redirectUri
          ) {
            toast.error('填写必填字段')
            return
          }
          createConnection.mutate({
            tenantID: draft.tenantID,
            provider: draft.provider,
            issuer: draft.issuer,
            clientID: draft.clientID,
            clientSecret: draft.clientSecret,
            redirectUri: draft.redirectUri,
            status: draft.status
          })
        }}>
        {!editing ? (
          <div className="space-y-2">
            <Label>租户</Label>
            <Input
              placeholder="租户标识"
              value={draft.tenantID}
              onChange={function (event) {
                updateDraft({ ...draft, tenantID: event.target.value })
              }}
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label>身份提供方</Label>
          <Input
            placeholder="如 oidc / azure"
            value={draft.provider}
            disabled={Boolean(editing)}
            onChange={function (event) {
              updateDraft({ ...draft, provider: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>签发方地址</Label>
          <Input
            placeholder="Issuer URL"
            value={draft.issuer}
            onChange={function (event) {
              updateDraft({ ...draft, issuer: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>客户端 ID</Label>
          <Input
            value={draft.clientID}
            onChange={function (event) {
              updateDraft({ ...draft, clientID: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>客户端密钥{editing ? '（可选）' : ''}</Label>
          <Input
            type="password"
            value={draft.clientSecret}
            onChange={function (event) {
              updateDraft({ ...draft, clientSecret: event.target.value })
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>回调地址</Label>
          <Input
            placeholder="Redirect URI"
            value={draft.redirectUri}
            onChange={function (event) {
              updateDraft({ ...draft, redirectUri: event.target.value })
            }}
          />
        </div>
      </EntitySheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除该 SSO 连接？"
        description="租户侧登录将立即失效。"
        confirmLabel="删除"
        destructive
        isPending={removeConnection.isPending}
        onOpenChange={function (open) {
          if (!open) updatePendingDelete(null)
        }}
        onConfirm={function () {
          if (pendingDelete) removeConnection.mutate(pendingDelete.id)
        }}
      />
    </ConsolePage>
  )
}
