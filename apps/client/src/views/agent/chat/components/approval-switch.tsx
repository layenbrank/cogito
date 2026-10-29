import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import {
  fetchSessionTools,
  writeToolPermissions,
  type ToolPermissionLevel
} from '@/features/agent/acp/goose-providers'
import { findThreadAcpSessionID, waitGooseReady } from '@/features/agent/acp/session'
import {
  APPROVAL_POLICIES,
  findApprovalPolicy,
  isWriteTool,
  readApprovalMode,
  writeApprovalMode,
  type ApprovalMode
} from '@/features/agent/approval.ts'
import { useAgentStore } from '@/stores/agent'

/** 输入区审批策略（对齐 Qoder「自动审批」） */
function ApprovalSwitch() {
  const [mode, updateMode] = useState<ApprovalMode>(readApprovalMode)
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })

  const current = findApprovalPolicy(mode)

  async function writeMode(next: ApprovalMode) {
    writeApprovalMode(next)
    updateMode(next)

    const acpSessionID = activeSessionID ? findThreadAcpSessionID(activeSessionID) : null
    if (!acpSessionID) {
      toast.success(`已设为「${findApprovalPolicy(next)?.label ?? next}」（打开会话后生效）`)
      return
    }

    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const tools = await fetchSessionTools(handle.connection, acpSessionID)
      const permissions = tools.map(function (tool) {
        let permission: ToolPermissionLevel
        if (next === 'auto') {
          permission = 'always_allow'
        } else if (next === 'ask') {
          permission = isWriteTool(tool.name) ? 'ask_before' : 'always_allow'
        } else {
          permission = isWriteTool(tool.name) ? 'never_allow' : 'ask_before'
        }
        return { toolName: tool.name, permission }
      })
      if (permissions.length > 0) {
        await writeToolPermissions(handle.connection, permissions)
      }
      toast.success(`已设为「${findApprovalPolicy(next)?.label ?? next}」`)
    } catch (error) {
      console.warn('[approval-switch] 写入工具权限失败:', error)
      toast.warning('策略已保存，同步到 goose 失败（可到设置里逐项调整）')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="工具审批策略"
            title={current?.hint}
            className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs font-normal"
          />
        }>
        <Icon
          icon="lucide:circle-check"
          className="size-3.5"
        />
        {current?.label ?? '询问审批'}
        <Icon
          icon="lucide:chevron-down"
          className="size-3.5"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64">
        {APPROVAL_POLICIES.map(function (policy) {
          const isCurrent = policy.value === mode
          return (
            <DropdownMenuItem
              key={policy.value}
              className="items-start gap-2"
              onClick={function () {
                void writeMode(policy.value)
              }}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>{policy.label}</span>
                <span className="text-muted-foreground text-xs leading-snug">{policy.hint}</span>
              </span>
              {isCurrent ? (
                <Icon
                  icon="lucide:check"
                  className="mt-0.5 size-3.5"
                />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ApprovalSwitch }
