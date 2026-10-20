import { Button } from '@i-thinking/design/components/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { DELETE_SSO_CONNECTION, GET_SSO_CONNECTIONS } from '@/apis/sso.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
import { HttpError } from '@/utils/http/errors.ts'

export default function SsoView() {
  const queryClient = useQueryClient()
  const connections = useQuery({ queryKey: ['sso-connections'], queryFn: GET_SSO_CONNECTIONS })
  const removeConnection = useMutation({
    mutationFn: DELETE_SSO_CONNECTION,
    onSuccess() {
      toast.success('已删除连接')
      void queryClient.invalidateQueries({ queryKey: ['sso-connections'] })
    },
    onError(error) {
      toast.error(HttpError(error).message)
    }
  })

  return (
    <div>
      <PageHeader
        title="SSO"
        description="OIDC 连接（平台运维）。client secret 只写不读。"
      />
      <ul className="divide-y divide-border/70 rounded-xl border border-border/80">
        {(connections.data ?? []).map(function (item) {
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">
                  {item.provider} · {item.status}
                </p>
                <p className="text-xs text-muted-foreground">
                  tenant {item.tenantID} · {item.issuer}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={function () {
                  if (!window.confirm('删除该 SSO 连接？')) return
                  removeConnection.mutate(item.id)
                }}>
                删除
              </Button>
            </li>
          )
        })}
        {!connections.isLoading && !(connections.data ?? []).length ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">暂无连接</li>
        ) : null}
      </ul>
    </div>
  )
}
