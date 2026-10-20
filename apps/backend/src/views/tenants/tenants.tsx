import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { GET_TENANT_MEMBERS, GET_TENANTS } from '@/apis/tenant.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'

export default function TenantsView() {
  const [activeID, updateActiveID] = useState<string | null>(null)
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: GET_TENANTS })
  const members = useQuery({
    queryKey: ['tenant-members', activeID],
    queryFn: function () {
      return GET_TENANT_MEMBERS(activeID!)
    },
    enabled: Boolean(activeID)
  })

  return (
    <div>
      <PageHeader
        title="租户"
        description="组织与成员。点选租户查看成员列表。"
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground uppercase">
              <tr className="border-b border-border">
                <th className="pb-2 font-medium">名称</th>
                <th className="pb-2 font-medium">类型</th>
                <th className="pb-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {(tenants.data ?? []).map(function (tenant) {
                const isActive = tenant.id === activeID
                return (
                  <tr
                    key={tenant.id}
                    className={[
                      'cursor-pointer border-b border-border/70',
                      isActive ? 'bg-accent/40' : 'hover:bg-accent/20'
                    ].join(' ')}
                    onClick={function () {
                      updateActiveID(tenant.id)
                    }}>
                    <td className="py-2.5 pr-3 font-medium">{tenant.name}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{tenant.kind}</td>
                    <td className="py-2.5">{tenant.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-border/80 p-4">
          <h3 className="mb-3 text-sm font-medium">成员</h3>
          {!activeID ? (
            <p className="text-sm text-muted-foreground">选择左侧租户</p>
          ) : members.isLoading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(members.data ?? []).map(function (member) {
                return (
                  <li
                    key={member.userID}
                    className="flex justify-between gap-2 border-b border-border/50 py-2">
                    <span className="truncate font-mono text-xs">{member.username ?? member.userID}</span>
                    <span className="text-muted-foreground">
                      {member.role} · {member.status}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
