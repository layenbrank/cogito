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
import { syncApprovalForThread } from '@/features/agent/acp/sync-thread-approval'
import {
  APPROVAL_POLICIES,
  findApprovalPolicy,
  readApprovalMode,
  subscribeApproval,
  writeApprovalMode,
  type ApprovalMode
} from '@/features/agent/approval.ts'
import { findEffectiveApprovalMode } from '@/features/agent/effective-approval'
import { readAgentModeFor } from '@/features/agent/mode'
import { readScopeThread } from '@/features/agent/thread-scope'

/** 输入区审批策略（Qoder 风格：图标 + 标题 + 说明 + 勾选） */
function ApprovalSwitch() {
  const snap = useSyncExternalStore(subscribeApproval, readScopeThread, readScopeThread)
  // 会话级状态：切会话后必须跟着刷新，否则显示的会是上一个会话的档位
  const mode = useSyncExternalStore(subscribeApproval, readApprovalMode, readApprovalMode)
  /**
   * 显示的是**有效档**而不是原始偏好：计划模式强制只读，偏好是「询问」也不该那么写。
   * 以前这里还拿 `store.activeSessionID` 去定位 ACP 会话 —— 那个指针只跟随启动时的
   * 列表首项，切会话后不更新，结果是「改 A 会话的档、推给 B 会话」。
   */
  const isPlanMode = snap ? readAgentModeFor(snap) === 'plan' : false
  const effective = snap ? findEffectiveApprovalMode(snap) : mode

  const current = findApprovalPolicy(effective)

  async function writeMode(next: ApprovalMode) {
    writeApprovalMode(next)

    if (!snap) {
      // 还没有会话：档位已生效（界面立刻是对的），推给 goose 要等这轮会话建起来
      toast.success(`已设为「${findApprovalPolicy(next)?.label ?? next}」（发送消息后生效）`)
      return
    }

    try {
      // 统一走「有效档」同步：计划模式下这里会把它改回只读
      await syncApprovalForThread(snap)
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
        <span className="hidden min-w-0 max-w-24 truncate @min-[29rem]:inline @min-[42rem]:max-w-none">
          {current?.label ?? '询问审批'}
        </span>
        <Icon
          icon="lucide:chevron-down"
          className="hidden size-3.5 shrink-0 opacity-70 @min-[29rem]:block"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className={styles.surface}>
        {APPROVAL_POLICIES.map(function (policy) {
          const isCurrent = policy.value === effective
          const isReadonly = policy.value === 'readonly'
          // 计划模式强制只读：其它两档点了也会被 `findEffectiveApprovalMode` 改回去，直接禁掉并说明
          const disabled = isPlanMode && policy.value !== 'readonly'
          return (
            <DropdownMenuItem
              key={policy.value}
              disabled={disabled}
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
                <span className={styles.hint}>{
                  disabled ? '计划模式强制只读（切到执行/问答模式后可改）' : policy.hint
                }</span>
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
