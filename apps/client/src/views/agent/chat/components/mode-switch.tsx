/**
 * 输入区会话模式选择：执行 / 计划 / 问答 / 目标。
 *
 * 与审批档正交：模式只改系统提示里的行为约束，审批仍是独立的安全档位。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import {
  AGENT_MODES,
  findAgentMode,
  readAgentMode,
  subscribeAgentMode,
  writeAgentMode
} from '@/features/agent/mode'
import type { AgentMode } from '@/features/persist'

// 与审批 / 模型选择器共用同一个浮层壳（无边框 + 软阴影）
import styles from './approval-switch.module.scss'

function AgentModeSwitch() {
  const mode = useSyncExternalStore(subscribeAgentMode, readAgentMode, readAgentMode)
  /** 菜单打开时的本地态只用于即时反馈，真实来源仍是持久化偏好 */
  const [, updateTick] = useState(0)
  const current = findAgentMode(mode)

  function write(next: AgentMode) {
    writeAgentMode(next)
    updateTick(function (value) {
      return value + 1
    })
    toast.success(`已切换到「${findAgentMode(next).label}」模式`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="会话模式"
            title={current.hint}
            className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs font-normal"
          />
        }>
        <Icon
          icon={current.icon}
          className="size-3.5"
        />
        {current.label}
        <Icon
          icon="lucide:chevron-down"
          className="size-3.5 opacity-70"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className={styles.surface}>
        {AGENT_MODES.map(function (item) {
          const isCurrent = item.value === mode
          return (
            <DropdownMenuItem
              key={item.value}
              className={styles.row}
              onClick={function () {
                write(item.value)
              }}>
              <Icon
                icon={item.icon}
                className={styles.icon}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={styles.label}>{item.label}</span>
                <span className={styles.hint}>{item.hint}</span>
              </span>
              {isCurrent ? (
                <Icon
                  icon="lucide:check"
                  className={styles.check}
                />
              ) : (
                <span className={styles.checkSlot} />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AgentModeSwitch }
