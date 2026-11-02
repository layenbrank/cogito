/**
 * 右栏「计划」页签：完整计划正文。
 *
 * 与「详情」的分工（对齐 Cursor / Copilot）：「详情」只给标题 + 概述 + 前几步做速览；
 * 这里是**全量计划正文**（概述、问题、方案、步骤、验证全在里面），不剔除步骤、
 * 不截断 —— 它同时也是「保存」写入文件的内容。
 *
 * 清单（todos）已不再落盘、也不再是执行依据，所以这里以正文为唯一内容源；
 * `draft.steps` 只用来算「共几步」的进度摘要。
 *
 * 调整计划请回对话里说 —— 右栏不提供输入框，避免两处改计划打架。
 */
import { Icon } from '@iconify/react/offline'
import { useAui, useAuiState } from '@assistant-ui/react'
import { MarkdownContent } from '@cogito/design/assistant/markdown-text'
import { TodoList } from '@cogito/design/assistant/todo-list'
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
import { findLatestPlan } from '@/features/agent/plan'
import { useActiveWorkspace } from '@/features/agent/workspace/active'

interface AsidePlanProps {
  isPlanMode: boolean
  /** `agent` = 普通执行；`goal` = 目标推进（自动续跑，中途不打断，轮次由 budget 指定） */
  onStartImplement: (target: 'agent' | 'goal', budget?: number) => void
}

/** 计划内容指纹：内容不变时不因 messages 引用变化而重算下游 */
function findPlanDigest(messages: Parameters<typeof findLatestPlan>[0]): string {
  const plan = findLatestPlan(messages)
  if (!plan) return ''
  let digest = `${plan.done}/${plan.total}`
  for (const entry of plan.entries) {
    digest += `|${entry.status}:${entry.content}`
  }
  return digest
}

function AsidePlan(props: AsidePlanProps) {
  const aui = useAui()
  const planDigest = useAuiState(function (state) {
    return findPlanDigest(state.thread.messages)
  })
  const draftDigest = useAuiState(function (state) {
    const next = findPlanDraft(state.thread.messages)
    if (!next) return ''
    return `${next.title}\0${next.overview}\0${next.body}\0${next.steps.join('\n')}`
  })
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const goal = useGoalRun(threadID)
  const { workspace, rootPath } = useActiveWorkspace()
  const plan = useMemo(
    function () {
      if (!planDigest) return null
      return findLatestPlan(aui.thread.getState().messages)
    },
    [aui, planDigest]
  )
  const draft = useMemo(
    function () {
      if (!draftDigest) return null
      return findPlanDraft(aui.thread.getState().messages)
    },
    [aui, draftDigest]
  )

  const items = useMemo(
    function () {
      if (plan && plan.entries.length > 0) {
        return plan.entries.map(function (entry) {
          return { content: entry.content, status: entry.status }
        })
      }
      return (draft?.steps ?? []).map(function (step) {
        return { content: step, status: 'pending' as const }
      })
    },
    [plan, draft]
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

  async function handleCopy() {
    const text = draft?.body ?? ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制计划全文')
    } catch (error) {
      console.warn('[agent/aside-plan] 复制计划失败:', error)
      toast.error('复制失败，请在正文里手动选择')
    }
  }

  if (!draft) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-center text-xs leading-relaxed">
        {props.isPlanMode
          ? '发出需求后，完整计划会显示在这里'
          : '用「计划」模式发起一轮对话，计划会显示在这里'}
      </div>
    )
  }

  const stepCount = plan?.total ?? draft.steps.length
  const doneCount = plan?.done ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 抬头信息条：标题 / 概述 / 进度；正文本身不重复这些 */}
      <div className="border-border/60 shrink-0 border-b px-3 py-2">
        <div className="text-foreground truncate text-sm font-medium">
          {draft.title || '计划草稿'}
        </div>
        {draft.overview ? (
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">
            {draft.overview}
          </p>
        ) : null}
        <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
          <Icon
            icon="lucide:list-checks"
            className="size-3 shrink-0"
          />
          <span>{stepCount > 0 ? `共 ${stepCount} 步` : '未分步'}</span>
          {doneCount > 0 ? <span>· 已完成 {doneCount}</span> : null}
          {draft.body ? <span className="ms-auto opacity-70">正文全文</span> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {draft.body ? <MarkdownContent markdown={draft.body} /> : <TodoList items={items} />}
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="复制计划全文"
          aria-label="复制计划全文"
          disabled={!draft.body}
          className="h-7 gap-1.5 text-xs"
          onClick={function () {
            void handleCopy()
          }}>
          <Icon
            icon="lucide:copy"
            className="size-3.5"
          />
          复制
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
