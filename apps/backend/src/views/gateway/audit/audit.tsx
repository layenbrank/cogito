import { Input } from '@i-thinking/design/components/input'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { GET_GATEWAY_AUDIT } from '@/apis/gateway.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'

export default function AuditView() {
  const [action, updateAction] = useState('')
  const audit = useQuery({
    queryKey: ['gateway-audit', action],
    queryFn: function () {
      return GET_GATEWAY_AUDIT({ action: action || undefined, size: 50 })
    }
  })

  return (
    <div>
      <PageHeader
        title="审计"
        description="网关操作时间线。可按 action 过滤。"
      />
      <Input
        className="mb-4 max-w-sm"
        placeholder="action（如 gateway.chat）"
        value={action}
        onChange={function (event) {
          updateAction(event.target.value)
        }}
      />
      <ol className="relative space-y-0 border-l border-border pl-6">
        {(audit.data ?? []).map(function (row) {
          return (
            <li
              key={row.id}
              className="mb-6">
              <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border border-background bg-[var(--backend-accent)]" />
              <time className="text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleString()}
              </time>
              <p className="mt-1 text-sm font-medium">
                {row.action}{' '}
                <span className="font-normal text-muted-foreground">{row.resource}</span>
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                actor {row.actor}
                {row.tenantID ? ` · tenant ${row.tenantID}` : ''}
                {row.ip ? ` · ${row.ip}` : ''}
              </p>
              {row.detail ? (
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{row.detail}</p>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
