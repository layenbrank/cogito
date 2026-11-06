/**
 * 右栏「计划」页签：进度速览 + **全量计划正文** + 档案状态。
 *
 * 版式分三段（自上而下）：
 *
 * 1. 抬头：标题 / 状态徽标 / 概述（最多两行）/ 绑定的计划文件；
 * 2. 滚动区：`elements/agent-plan` 的**不折叠**版（进度条 + 全部步骤的状态）
 *    → 分隔线 → 完整 Markdown 正文（与保存/执行用的是同一份内容，一个字不删）；
 * 3. 操作区：主操作（开始执行 / 目标推进）+ 一行图标按钮（保存 / 复制 / 载入 / 标记完成）。
 *
 * 与对话里的计划卡分工：那边折到「表头 + 进度条 + 正在做的一步」，只做速览；
 * 这里是**全量**（所有步骤 + 正文），也是「保存」写入文件的内容。
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
import { AgentPlan } from '@cogito/design/assistant/agent-plan'
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
import type { ChatPlanEntry } from '@cogito/chat/ports'
import { cn } from 'cn'
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
  isPlanStale,
  savePlan,
  setPlanStatus,
  usePlanRecord,
  type PlanRecord,
  type PlanStatus
} from '@/features/agent/plan-store'
import { useActiveWorkspace } from '@/features/agent/workspace/active'

import { toActiveIndex, toPlanSteps } from './plan-steps'

interface AsidePlanProps {
  isPlanMode: boolean
  /** `agent` = 普通执行；`goal` = 目标推进（自动续跑，中途不打断，轮次由 budget 指定） */
  onStartImplement: (target: 'agent' | 'goal', budget?: number) => void
}

/** 状态徽标：走设计 token（不再手调 violet / emerald / amber） */
const STATUS_META: Record<PlanStatus, { label: string; tone: string; icon: string }> = {
  draft: {
    label: '草稿',
    tone: 'text-muted-foreground bg-foreground/[0.05]',
    icon: 'lucide:pencil-line'
  },
  running: { label: '执行中', tone: 'text-primary bg-primary/10', icon: 'lucide:play' },
  done: { label: '已完成', tone: 'text-success bg-success/10', icon: 'lucide:check' },
  interrupted: { label: '已中断', tone: 'text-foreground bg-warning/20', icon: 'lucide:pause' },
  superseded: {
    label: '已归档',
    tone: 'text-muted-foreground bg-foreground/[0.05]',
    icon: 'lucide:archive'
  }
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

  /** 步骤数据：结构化 plan 优先；只有草稿时按「待办」铺开（元素用 idle 表达） */
  const entries = useMemo<readonly ChatPlanEntry[]>(
    function () {
      if (plan && plan.entries.length > 0) return plan.entries
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
        steps: entries.map(function (entry) {
          return entry.content
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

  const stored: PlanRecord | null = record
  const status = stored?.status ?? 'draft'
  const statusMeta = STATUS_META[status]
  /**
   * 计划改过、但还没按新版执行过：`revision > executedRevision`（见 `isPlanStale`）。
   * 早先只看 `done && updatedAt > finishedAt`，于是 `running`（目标推进中）与
   * `interrupted` 都不提示，按钮还叫「开始执行」—— 点下去跑的就是旧版。
   */
  const isStale = isPlanStale(stored)
  /** 已归档、且没有更新版本可执行：只读（保存 / 复制 / 载入照常可用） */
  const isArchived = status === 'superseded' && !isStale
  const canExecute = !isArchived
  /** 上次执行基于第几版；老库行只有 executedAt，没有 executedRevision → 说「旧版」 */
  const executedLabel =
    stored?.executedRevision === null || stored?.executedRevision === undefined
      ? '旧版'
      : `r${stored.executedRevision}`
  /** 只有草稿（没有结构化 plan 事件）= 还没开始：全部圆点、进度 0 */
  const isIdle = !plan

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 抬头信息条：标题 / 概述 / 状态 / 绑定的计划文件；正文本身不重复这些 */}
      <div className="border-border/60 shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
            {draft.title || '计划草稿'}
          </h2>
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium',
              statusMeta.tone
            )}
            title={
              isStale
                ? `计划已更新到 r${stored?.revision ?? 1}，上次执行基于 ${executedLabel}`
                : isArchived
                  ? '这份计划已被新版取代，只读'
                  : statusMeta.label
            }>
            <Icon icon={statusMeta.icon} className="size-3" />
            {isStale ? '已更新' : statusMeta.label}
          </span>
        </div>
        {draft.overview ? (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
            {draft.overview}
          </p>
        ) : null}
        {stored?.filePath || (stored && stored.revision > 1) ? (
          <div className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
            <Icon icon="lucide:file-text" className="size-3 shrink-0" />
            <span className="min-w-0 truncate font-mono" title={stored?.filePath ?? undefined}>
              {stored?.filePath ?? '未绑定文件'}
            </span>
            {stored && stored.revision > 1 ? (
              <span className="shrink-0 font-mono opacity-70">{`r${stored.revision}`}</span>
            ) : null}
            {isStale && stored ? (
              <span className="shrink-0 opacity-70">{`上次执行基于 ${executedLabel}`}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 进度卡：不折叠 —— 这里就是「全量计划」的那一份清单 */}
        {entries.length > 0 ? (
          <div className="px-3 pt-3">
            <div className="border-border/60 bg-background dark:bg-popover rounded-xl border p-3">
              <AgentPlan
                title="步骤"
                steps={toPlanSteps(entries)}
                activeIndex={toActiveIndex(entries)}
                idle={isIdle}
                className="max-w-none"
              />
            </div>
          </div>
        ) : null}

        {/* 全量正文：与「保存 / 开始执行」用的是同一份内容 */}
        {draft.body ? (
          <div className="border-border/60 mt-3 border-t px-3 pt-2.5 pb-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
              <Icon icon="lucide:align-left" className="size-3" />
              完整计划
            </div>
            <MarkdownContent
              markdown={draft.body}
              // 右栏窄：正文标题压到与段落接近的字号，免得一个 `##` 就把整屏撑满
              className="text-sm [&_h1]:mt-3 [&_h1]:text-base [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:mt-2 [&_h3]:text-sm"
            />
          </div>
        ) : null}
      </div>

      {goal ? (
        <div className="border-border/60 text-muted-foreground flex shrink-0 items-center gap-1.5 border-t px-3 py-1.5 text-xs">
          <Icon icon="lucide:target" className="text-primary size-3.5 shrink-0" />
          <span className="truncate">
            {goal.status === 'exhausted'
              ? `目标推进已用尽 · ${goal.used}/${goal.budget} 轮`
              : `目标推进中 · 第 ${Math.min(goal.used + 1, goal.budget)}/${goal.budget} 轮`}
            {goal.progress ? ` · 标准 ${goal.progress.done}/${goal.progress.total}` : ''}
          </span>
          <span className="ms-auto shrink-0">
            {goal.status === 'exhausted' ? '预算用尽' : '中途不打断'}
          </span>
        </div>
      ) : null}

      {/* 主操作：一行两个，执行占满剩余宽度 */}
      <div className="border-border/60 flex shrink-0 items-center gap-2 border-t px-3 py-2">
        {/* 按钮不再被 `isPlanMode` 包住：切到执行模式后「开始执行」仍然要在 */}
        <Button
          type="button"
          size="sm"
          className="flex-1 text-xs"
          disabled={!canExecute}
          title={
            canExecute
              ? isStale
                ? `按 r${stored?.revision ?? 1} 的正文执行（上次跑的是 ${executedLabel}）`
                : '按当前计划正文执行'
              : '这份计划已被新版取代：先按新计划执行，或把正文另存为一份新计划'
          }
          onClick={function () {
            props.onStartImplement('agent')
          }}>
          <Icon icon={isStale || status !== 'done' ? 'lucide:play' : 'lucide:rotate-ccw'} />
          {isStale
            ? `按新计划执行（r${stored?.revision ?? 1}）`
            : isArchived
              ? '已归档'
              : status === 'done' || status === 'interrupted'
                ? '重新执行'
                : '开始执行'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-xs"
          disabled={!canExecute}
          title={`目标推进：自动续跑，本轮最多 ${budget} 轮（轮次在输入框下方向切换，每次发送都可以不同）`}
          onClick={function () {
            props.onStartImplement('goal', budget)
          }}>
          <Icon icon="lucide:target" />
          目标推进 · {budget} 轮
        </Button>
      </div>

      {/* 次要操作：纯图标（都带 title / aria-label），左边三个一组、右侧标记完成 */}
      <div className="border-border/60 flex shrink-0 items-center gap-1 border-t px-2 py-1">
        <PlanIconButton
          icon="lucide:save"
          label="保存计划"
          onClick={function () {
            void handleSave()
          }}
        />
        <PlanIconButton
          icon="lucide:copy"
          label="复制计划全文"
          disabled={!draft.body}
          onClick={function () {
            void handleCopy()
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                title="从工作区 .cogito/plans 载入一份已保存的计划（按修改时间倒序）"
                aria-label="从文件载入计划"
                disabled={!rootPath || isListing}
              />
            }>
            <Icon icon="lucide:folder-open" className="size-3.5" />
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
        <span className="flex-1" />
        {status === 'running' || status === 'draft' ? (
          <PlanIconButton
            icon="lucide:check-check"
            label="手动把这份计划标记为已完成"
            onClick={handleMarkDone}
          />
        ) : null}
      </div>
    </div>
  )
}

/** 右栏底部的次要操作：统一成 28px 的图标按钮，文字只留在 title / aria-label */
function PlanIconButton(props: {
  icon: string
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      className="text-muted-foreground hover:text-foreground"
      onClick={props.onClick}>
      <Icon icon={props.icon} className="size-3.5" />
    </Button>
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
            <Icon icon="lucide:file-text" className="text-muted-foreground size-3.5 shrink-0" />
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
