/**
 * 右栏「计划」页签：完整计划正文 + 档案状态。
 *
 * 与「详情」的分工（对齐 Cursor / Copilot）：「详情」只给标题 + 概述 + 前几步做速览；
 * 这里是**全量计划正文**（概述、问题、方案、步骤、验证全在里面），不剔除步骤、
 * 不截断 —— 它同时也是「保存」写入文件的内容。
 *
 * 内容源有两层：
 * 1. `agent_plan` 档案（`readPlan`）—— 计划不再随着「最后一条 assistant 正文」
 *    变化而消失，状态（草稿/执行中/已完成/已中断）、修订号、文件路径都在这里；
 * 2. 当轮草稿（`findPlanDraft`）—— 还没被 recorder 录进档案时的兜底。
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
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import {
  listPlanFiles,
  readPlanFile,
  savePlanToWorkspace,
  type PlanFileEntry
} from '@/features/agent/plan-file'
import { readNextGoalBudget, subscribeGoalBudget, useGoalRun } from '@/features/agent/goal-run'
import { findPlanDraft } from '@/features/agent/plan-draft'
import { findLatestPlan } from '@/features/agent/plan'
import {
  savePlan,
  setPlanStatus,
  usePlanRecord,
  type PlanRecord,
  type PlanStatus
} from '@/features/agent/plan-store'
import { useActiveWorkspace } from '@/features/agent/workspace/active'

interface AsidePlanProps {
  isPlanMode: boolean
  /** `agent` = 普通执行；`goal` = 目标推进（自动续跑，中途不打断，轮次由 budget 指定） */
  onStartImplement: (target: 'agent' | 'goal', budget?: number) => void
}

/** 状态徽标：计划不再只有「有 / 没有」两态 */
const STATUS_META: Record<PlanStatus, { label: string; tone: string; icon: string }> = {
  draft: { label: '草稿', tone: 'text-muted-foreground bg-muted/60', icon: 'lucide:pencil-line' },
  running: {
    label: '执行中',
    tone: 'text-violet-700 bg-violet-500/10 dark:text-violet-200',
    icon: 'lucide:play'
  },
  done: {
    label: '已完成',
    tone: 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300',
    icon: 'lucide:check'
  },
  interrupted: {
    label: '已中断',
    tone: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
    icon: 'lucide:pause'
  },
  superseded: { label: '已归档', tone: 'text-muted-foreground bg-muted/60', icon: 'lucide:archive' }
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
  const record = usePlanRecord(threadID)
  const goal = useGoalRun(threadID)
  /** 轮次是「每次发送」的输入项：这里只读，修改入口在 composer 下方的目标轮次 */
  const budget = useSyncExternalStore(subscribeGoalBudget, readNextGoalBudget, readNextGoalBudget)
  const { workspace, rootPath } = useActiveWorkspace()
  const [isListing, updateListing] = useState(false)

  const plan = useMemo(
    function () {
      if (!planDigest) return null
      return findLatestPlan(aui.thread.getState().messages)
    },
    [aui, planDigest]
  )
  const draft = useMemo(
    function () {
      if (record) {
        return {
          title: record.title,
          overview: record.overview,
          steps: record.steps,
          body: record.body
        }
      }
      if (!draftDigest) return null
      return findPlanDraft(aui.thread.getState().messages)
    },
    [aui, draftDigest, record]
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
    if (!threadID) return
    try {
      const relative = await savePlanToWorkspace(rootPath, {
        title: draft?.title || workspace?.title || '计划',
        overview: draft?.overview ?? '',
        steps: items.map(function (item) {
          return item.content
        }),
        body: draft?.body ?? ''
      })
      // 保存即绑定：之后「从文件载入」与执行都用同一份文档
      savePlan({ sessionID: threadID, source: 'file', filePath: relative })
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

  async function handleListFiles(): Promise<PlanFileEntry[]> {
    if (!rootPath) {
      toast.error('先在左栏添加一个工作区')
      return []
    }
    updateListing(true)
    try {
      return await listPlanFiles(rootPath)
    } catch (error) {
      console.warn('[agent/aside-plan] 列出计划文件失败:', error)
      toast.error('读取 .cogito/plans 失败')
      return []
    } finally {
      updateListing(false)
    }
  }

  async function handleLoadFile(relative: string) {
    if (!rootPath || !threadID) return
    try {
      const content = await readPlanFile(rootPath, relative)
      savePlan({
        sessionID: threadID,
        title: content.title,
        overview: content.overview,
        steps: content.body
          .split('\n')
          .map(function (line) {
            return line.match(/^\s*\d+[.、)]\s+(.+)$/)?.[1] ?? ''
          })
          .filter(function (line) {
            return line.length > 0
          }),
        body: content.body,
        source: 'file',
        filePath: relative,
        status: 'draft'
      })
      toast.success(`已载入 ${relative}`)
    } catch (error) {
      console.warn('[agent/aside-plan] 载入计划文件失败:', error)
      toast.error(error instanceof Error ? error.message : '载入计划文件失败')
    }
  }

  function handleMarkDone() {
    if (!threadID) return
    setPlanStatus(threadID, 'done')
    toast.success('已标记为完成')
  }

  if (!draft) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-center text-xs leading-relaxed">
        {props.isPlanMode
          ? '等待模型按骨架产出完整 Markdown 计划；结束后若仍为空，说明本轮未按概述/实施步骤等章节输出'
          : '用「计划」模式发起一轮对话，计划会显示在这里'}
      </div>
    )
  }

  const stepCount = plan?.total ?? draft.steps.length
  const doneCount = plan?.done ?? 0
  const stored: PlanRecord | null = record
  const status = stored?.status ?? 'draft'
  const statusMeta = STATUS_META[status]
  /** `done` 之后正文又被改过（recorder 自增过 revision）→ 提示需要重新执行 */
  const isOutdated =
    status === 'done' &&
    typeof stored?.finishedAt === 'number' &&
    stored.updatedAt > stored.finishedAt

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 抬头信息条：标题 / 概述 / 状态 / 进度；正文本身不重复这些 */}
      <div className="border-border/60 shrink-0 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
            {draft.title || '计划草稿'}
          </div>
          <span
            className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${statusMeta.tone}`}
            title={isOutdated ? '计划已更新，需重新执行' : statusMeta.label}>
            <Icon
              icon={statusMeta.icon}
              className="size-3"
            />
            {isOutdated ? '已更新' : statusMeta.label}
            {stored && stored.revision > 1 ? ` · r${stored.revision}` : ''}
          </span>
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
          {stored?.filePath ? (
            <span
              className="ms-auto max-w-40 truncate font-mono text-[11px] opacity-70"
              title={stored.filePath}>
              {stored.filePath}
            </span>
          ) : draft.body ? (
            <span className="ms-auto opacity-70">正文全文</span>
          ) : null}
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
            {goal.status === 'exhausted'
              ? `目标推进已用尽 · ${goal.used}/${goal.budget} 轮`
              : `目标推进中 · 第 ${Math.min(goal.used + 1, goal.budget)}/${goal.budget} 轮`}
            {goal.progress ? ` · 标准 ${goal.progress.done}/${goal.progress.total}` : ''}
          </span>
          <span className="ml-auto shrink-0">
            {goal.status === 'exhausted' ? '预算用尽' : '中途不打断'}
          </span>
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
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                title="从工作区 .cogito/plans 载入一份已保存的计划（按修改时间倒序）"
                disabled={!rootPath || isListing}
              />
            }>
            <Icon
              icon="lucide:folder-open"
              className="size-3.5"
            />
            从文件载入
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            sideOffset={8}
            className="max-h-80 w-auto min-w-56 max-w-80 overflow-y-auto p-1">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold">
                .cogito/plans
              </DropdownMenuLabel>
              <LoadFileItems
                onOpen={handleListFiles}
                onPick={function (relative) {
                  void handleLoadFile(relative)
                }}
              />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="border-border/60 flex shrink-0 items-center gap-2 border-t px-3 py-2">
        {/* 按钮不再被 `isPlanMode` 包住：切到执行模式后「开始执行」仍然要在 */}
        <Button
          type="button"
          size="sm"
          className="h-7 flex-1 gap-1.5 text-xs"
          onClick={function () {
            props.onStartImplement('agent')
          }}>
          <Icon
            icon={status === 'done' ? 'lucide:rotate-ccw' : 'lucide:play'}
            className="size-3.5"
          />
          {status === 'done' || status === 'interrupted' ? '重新执行' : '开始执行'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          title={`目标推进：自动续跑，本轮最多 ${budget} 轮（轮次在输入框下方向切换，每次发送都可以不同）`}
          className="h-7 gap-1.5 text-xs"
          onClick={function () {
            props.onStartImplement('goal', budget)
          }}>
          <Icon
            icon="lucide:target"
            className="size-3.5"
          />
          目标推进 · {budget} 轮
        </Button>
        {status === 'running' || status === 'draft' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            title="手动把这份计划标记为已完成"
            onClick={handleMarkDone}>
            <Icon
              icon="lucide:check-check"
              className="size-3.5"
            />
            标记完成
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** 文件列表按需加载：打开菜单才读目录，避免每次渲染都打 fs */
function LoadFileItems(props: {
  onOpen: () => Promise<PlanFileEntry[]>
  onPick: (relative: string) => void
}) {
  const [entries, updateEntries] = useState<PlanFileEntry[] | null>(null)

  useEffect(
    function () {
      let alive = true
      void props.onOpen().then(function (rows) {
        if (alive) updateEntries(rows)
      })
      return function () {
        alive = false
      }
    },
    // 打开菜单时读一次目录即可；`onOpen` 每次渲染都是新函数，故意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  if (!entries) {
    return <p className="text-muted-foreground px-2 py-1.5 text-xs">正在读取…</p>
  }
  if (entries.length === 0) {
    return <p className="text-muted-foreground px-2 py-1.5 text-xs">还没有保存过计划</p>
  }
  return (
    <>
      {entries.map(function (entry) {
        return (
          <DropdownMenuItem
            key={entry.relative}
            title={entry.relative}
            className="gap-2"
            onClick={function () {
              props.onPick(entry.relative)
            }}>
            <Icon
              icon="lucide:file-text"
              className="text-muted-foreground size-3.5 shrink-0"
            />
            <span className="min-w-0 flex-1 truncate text-xs">{entry.name}</span>
            <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
              {entry.modifiedAt > 0
                ? new Date(entry.modifiedAt).toLocaleDateString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit'
                  })
                : '—'}
            </span>
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

export { AsidePlan }
