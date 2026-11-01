import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import styles from './approval-switch.module.scss'
import { findAcpHandle } from '@/features/agent/acp/connection'
import { syncSessionApprovalMode } from '@/features/agent/acp/sync-approval-mode'
import { findThreadAcpSessionID, waitGooseReady } from '@/features/agent/acp/session'
import {
  APPROVAL_POLICIES,
  findApprovalPolicy,
  readApprovalMode,
  subscribeApproval,
  writeApprovalMode,
  type ApprovalMode
} from '@/features/agent/approval.ts'
import { useAgentStore } from '@/stores/agent'

/** 输入区审批策略（Qoder 风格：图标 + 标题 + 说明 + 勾选） */
function ApprovalSwitch() {
  // 会话级状态：切会话后必须跟着刷新，否则显示的会是上一个会话的档位
  const mode = useSyncExternalStore(subscribeApproval, readApprovalMode, readApprovalMode)
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })

  const current = findApprovalPolicy(mode)

  async function writeMode(next: ApprovalMode) {
    writeApprovalMode(next)

    const acpSessionID = activeSessionID ? findThreadAcpSessionID(activeSessionID) : null
    if (!acpSessionID) {
      toast.success(`已设为「${findApprovalPolicy(next)?.label ?? next}」（打开会话后生效）`)
      return
    }

    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      await syncSessionApprovalMode(handle.connection, acpSessionID, next)
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
            className="text-muted-foreground hover:text-foreground h-7 max-w-full min-w-0 shrink gap-1 px-2 text-xs font-normal"
          />
        }>
        <Icon
          icon={current?.icon ?? 'lucide:shield'}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 max-w-[4.5rem] truncate sm:max-w-[6rem] md:max-w-none">
          {current?.label ?? '询问审批'}
        </span>
        <Icon
          icon="lucide:chevron-down"
          className="size-3.5 shrink-0 opacity-70"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className={styles.surface}>
        {APPROVAL_POLICIES.map(function (policy) {
          const isCurrent = policy.value === mode
          const isReadonly = policy.value === 'readonly'
          return (
            <DropdownMenuItem
              key={policy.value}
              className={`${styles.row} ${isReadonly ? styles.rowReadonly : ''}`}
              onClick={function () {
                void writeMode(policy.value)
              }}>
              <Icon
                icon={policy.icon}
                className={`${styles.icon} ${isReadonly ? 'text-muted-foreground' : 'text-foreground/80'}`}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`${styles.label} ${isReadonly ? styles.labelMuted : ''}`}>
                  {policy.label}
                </span>
                <span className={styles.hint}>{policy.hint}</span>
              </span>
              {isCurrent ? (
                <Icon
                  icon="lucide:check"
                  className={styles.check}
                />
              ) : (
                <span
                  className={styles.checkSlot}
                  aria-hidden
                />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ApprovalSwitch }
