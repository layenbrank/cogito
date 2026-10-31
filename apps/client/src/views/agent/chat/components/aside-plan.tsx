/**
 * 右栏「计划」页签：完整计划文档。
 *
 * 与「详情」的分工（对齐 Cursor / Copilot）：「详情」只给任务清单做进度速览；
 * 这里是**全量计划正文**（概述、问题、方案、步骤、验证全在里面），不剔除步骤、
 * 不截断 —— 它同时也是「保存」写入文件的内容。
 *
 * 调整计划请回对话里说 —— 右栏不提供输入框，避免两处改计划打架。
 */
import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { TodoList } from '@cogito/design/assistant/todo-list'
import { MarkdownContent } from '@cogito/design/assistant/markdown-text'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { savePlanToWorkspace } from '@/features/agent/plan-file'
import { DEFAULT_BUDGET, GOAL_BUDGET_OPTIONS, useGoalRun } from '@/features/agent/goal-run'
import { findPlanDraft } from '@/features/agent/plan-draft'
import type { PlanSnapshot } from '@/features/agent/plan'
import { useActiveWorkspace } from '@/features/agent/workspace/active'

interface AsidePlanProps {
  plan: PlanSnapshot | null
  isPlanMode: boolean
  /** `agent` = 普通执行；`goal` = 目标推进（自动续跑，中途不打断，轮次由 budget 指定） */
  onStartImplement: (target: 'agent' | 'goal', budget?: number) => void
}

function AsidePlan(props: AsidePlanProps) {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const goal = useGoalRun(threadID)
  const { workspace, rootPath } = useActiveWorkspace()
  const draft = useMemo(
    function () {
      return findPlanDraft(messages)
    },
    [messages]
  )

  const items = useMemo(
    function () {
      if (props.plan && props.plan.entries.length > 0) {
        return props.plan.entries.map(function (entry) {
          return { content: entry.content, status: entry.status }
        })
      }
      return (draft?.steps ?? []).map(function (step) {
        return { content: step, status: 'pending' as const }
      })
    },
    [props.plan, draft]
  )

  async function handleSave() {
    if (!rootPath) {
      toast.error('先在左栏添加一个工作区')
      return
    }
    try {
      const relative = await savePlanToWorkspace(rootPath, {
        title: draft?.title || workspace?.title || '计划',
        overview: draft?.overview ?? '',
        steps: items.map(function (item) {
          return item.content
        }),
        body: draft?.body ?? ''
      })
      toast.success(`计划已保存到 ${relative}`)
    } catch (error) {
      console.warn('[agent/aside-plan] 保存计划失败:', error)
      toast.error(error instanceof Error ? error.message : '保存计划失败')
    }
  }

  if (items.length === 0 && !draft?.body) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-center text-xs leading-relaxed">
        {props.isPlanMode ? '发出需求后，完整计划会显示在这里' : '用「计划」模式发起一轮对话，计划会显示在这里'}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {draft?.body ? (
          <MarkdownContent markdown={draft.body} />
        ) : (
          <TodoList items={items} />
        )}
      </div>

      {goal ? (
        <div className="border-border/60 text-muted-foreground flex shrink-0 items-center gap-1.5 border-t px-3 py-1.5 text-xs">
          <Icon
            icon="lucide:target"
            className="size-3.5 shrink-0 text-violet-500"
          />
          <span className="truncate">
            目标推进中 · 第 {Math.min(goal.used + 1, goal.budget)}/{goal.budget} 轮
            {goal.progress ? ` · 标准 ${goal.progress.done}/${goal.progress.total}` : ''}
          </span>
          <span className="ml-auto shrink-0">中途不打断</span>
        </div>
      ) : null}

      <div className="border-border/60 flex shrink-0 items-center gap-2 border-t px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={function () {
            void handleSave()
          }}>
          <Icon
            icon="lucide:save"
            className="size-3.5"
          />
          保存
        </Button>
        {props.isPlanMode ? (
          <>
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 gap-1.5 text-xs"
              onClick={function () {
                props.onStartImplement('agent')
              }}>
              <Icon
                icon="lucide:play"
                className="size-3.5"
              />
              开始执行
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    title="目标推进：自动续跑，中途不停下来问"
                    className="h-7 gap-1.5 text-xs"
                  />
                }>
                <Icon
                  icon="lucide:target"
                  className="size-3.5"
                />
                目标推进
                <Icon
                  icon="lucide:chevron-down"
                  className="size-3 shrink-0 opacity-60"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-36">
                {/* Base UI 的 GroupLabel 必须在 Menu.Group 内，否则运行时抛 MenuGroupContext missing */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    推进轮次上限
                  </DropdownMenuLabel>
                  {GOAL_BUDGET_OPTIONS.map(function (budget) {
                    return (
                      <DropdownMenuItem
                        key={budget}
                        onClick={function () {
                          props.onStartImplement('goal', budget)
                        }}>
                        <Icon
                          icon={budget === DEFAULT_BUDGET ? 'lucide:check' : 'lucide:circle'}
                          className="size-3.5 opacity-70"
                        />
                        最多 {budget} 轮
                        {budget === DEFAULT_BUDGET ? (
                          <span className="text-muted-foreground ml-auto text-xs">默认</span>
                        ) : null}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <span className="text-muted-foreground flex-1 text-xs">切到「计划」模式可确认后执行</span>
        )}
      </div>
    </div>
  )
}

export { AsidePlan }
