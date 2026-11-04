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
import { clsx } from 'clsx'
import { useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import {
  GOAL_BUDGET_OPTIONS,
  readNextGoalBudget,
  subscribeGoalBudget,
  writeNextGoalBudget
} from '@/features/agent/goal-run'
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
  /** 目标模式的「推进轮次」是**每次发送**的输入项：跟模式绑定，跟着发送一起消费 */
  const budget = useSyncExternalStore(subscribeGoalBudget, readNextGoalBudget, readNextGoalBudget)
  /** 菜单打开时的本地态只用于即时反馈，真实来源仍是持久化偏好 */
  const [, updateTick] = useState(0)
  const current = findAgentMode(mode)

  function write(next: AgentMode) {
    void writeAgentMode(next)
      .then(function () {
        updateTick(function (value) {
          return value + 1
        })
        toast.success(`已切换到「${findAgentMode(next).label}」模式（下一轮发送生效）`)
      })
      .catch(function (error: unknown) {
        console.warn('[agent/mode-switch] 切换模式失败:', error)
        toast.error('切换模式失败，请重试')
      })
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
            className="text-muted-foreground hover:text-foreground h-7 max-w-full min-w-0 shrink gap-1 px-2 text-xs font-normal"
          />
        }>
        <Icon
          icon={current.icon}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 max-w-[3.5rem] truncate sm:max-w-[5rem] md:max-w-none">
          {current.label}
        </span>
        {mode === 'goal' ? (
          <span className="text-violet-700 dark:text-violet-300 shrink-0 font-medium tabular-nums">
            · {budget} 轮
          </span>
        ) : null}
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

        {/*
         * 轮次只属于目标模式，并且**每条消息单独设置**（发送时消费一次）。
         * 放在模式菜单里而不是 footer：用户选「目标」的那一刻就是决定「自动推进几轮」的时刻，
         * 两件事分开摆才容易误以为「轮次」是个全局开关。
         */}
        {mode === 'goal' ? (
          <div className="border-border/70 mt-1 flex flex-col gap-1.5 border-t px-2 pt-2 pb-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-[11px] font-medium">
                这条消息最多自动推进
              </span>
              <span className="text-muted-foreground/60 text-[11px]">每条消息单独设置</span>
            </div>
            <div className="flex items-center gap-1">
              {GOAL_BUDGET_OPTIONS.map(function (option) {
                const active = option === budget
                return (
                  <button
                    key={option}
                    type="button"
                    title={
                      option === 3
                        ? '小改动 / 单点验证'
                        : option === 6
                          ? '常规任务（默认）'
                          : '大改造 / 长链路'
                    }
                    onClick={function () {
                      writeNextGoalBudget(option)
                    }}
                    className={clsx(
                      'flex-1 rounded-md border px-2 py-1 text-xs tabular-nums transition-colors',
                      active
                        ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium'
                        : 'border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}>
                    {option} 轮
                  </button>
                )
              })}
            </div>
            <p className="text-muted-foreground/80 text-[11px] leading-snug">
              跑满即停并给出收尾总结；不会跨消息累加，下一条消息重新按这里的值算。
            </p>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AgentModeSwitch }
