/**
 * 右栏「详情」：一眼看清「这轮在干什么、动过哪些文件、有哪些后台会话」。
 *
 * 设计取向（2026-11 重构）：
 * - **状态优先**：顶部常驻状态条说明「运行中 / 空闲 + 当前命令」，正文再分卡片；
 *   以前所有分区一样重，用户得逐个扫才能判断 agent 到底有没有在动。
 * - **可读性**：正文 13px、标题 14px、元信息 12px，卡片 12px 圆角 + 细描边，
 *   不再用 11px 堆信息 —— 右栏是给人看的，不是给密度看的。
 * - **可操作**：命令行、文件行、终端会话行都是按钮，点一下就到对应面板；
 *   后台会话（刷新后从 Rust 灌回来的）也列在这里，可直接关闭。
 */
import { Icon } from '@iconify/react/offline'
import { useAui, useAuiState } from '@assistant-ui/react'
import { Source, Sources, SourcesContent, SourcesTrigger } from '@cogito/design/assistant/sources'
import { formatToolElapsed } from '@cogito/design/assistant/tool'
import { TodoList } from '@cogito/design/assistant/todo-list'
import { Button } from '@cogito/design/components/button'
import { invoke } from '@tauri-apps/api/core'
import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'

import { collectToolPaths } from '@/features/agent/tool-paths.ts'
import { readApprovalMode, findApprovalPolicy } from '@/features/agent/approval.ts'
import { useGoalRun } from '@/features/agent/goal-run'
import { findAgentMode, readAgentMode, subscribeAgentMode } from '@/features/agent/mode.ts'
import { savePlanToWorkspace } from '@/features/agent/plan-file'
import { findLatestPlan } from '@/features/agent/plan'
import { findPlanDraft } from '@/features/agent/plan-draft'
import { usePlanRecord } from '@/features/agent/plan-store'
import type { PlanDraft } from '@/features/agent/plan-draft'
import { useSessionCommands } from '@/features/agent/running-commands'
import type { SessionCommandState } from '@/features/agent/running-commands'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { refreshNow, useWorkspaceGitSnapshot } from '@/features/agent/workspace/git.ts'
import {
  findGooseUsage,
  formatGooseUsage,
  subscribeGooseUsage
} from '@/features/agent/acp/goose-usage'
import { Terminal } from '@/lib/terminal'
import { bootstrapTerminalSessions } from '@/features/terminal/agent-tabs'
import { useTerminalStore } from '@/stores/terminal'
import { CHANNELS } from '@/shared/ipc/channels'
import { useProviderStore } from '@/stores/provider'
import { findStatusBadge, groupEntries } from '@/views/code/lib/git-status.ts'
import { useStructuralThreadMessages } from '@/views/agent/chat/components/use-structural-messages.ts'

interface AsideOutputRow {
  path: string
  /** git 状态徽标（M/A/D/R）；仅工具触及、尚未进 git 感知时为空 */
  badge: string | null
}

interface AsideBusyProps {
  onOpenFiles: (relative?: string | null) => void
  onOpenReview: (relative?: string | null) => void
  /** 跳到右栏「计划」页签看正文全文 */
  onOpenPlan: () => void
  /** 跳到右栏终端页签；给了命令则优先选中正在跑这条命令的 tab */
  onOpenTerminal: (
    command: string,
    workdir?: string | null,
    source?: SessionCommandState['source']
  ) => void
  /** 当前会话是否处于「计划」模式：空态文案据此区分 */
  isPlanMode: boolean
}

interface ProbeR {
  isRepo: boolean
  branch: string | null
}

function truncatePath(path: string, max = 42) {
  if (path.length <= max) return path
  return `…${path.slice(-(max - 1))}`
}

function findBaseName(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

/** 卡片：标题 14px / 正文 13px，圆角 12，细描边；右侧可挂一个动作 */
function Section(props: {
  icon: string
  /** 图标点缀色；缺省跟随 muted */
  iconClass?: string
  title: string
  meta?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={clsx(
        'border-border/60 bg-card flex flex-col gap-2.5 rounded-xl border p-3 shadow-xs',
        props.className
      )}>
      <div className="flex items-center gap-2">
        <Icon
          icon={props.icon}
          className={clsx('size-4 shrink-0', props.iconClass ?? 'text-muted-foreground')}
        />
        <span className="text-foreground min-w-0 truncate text-sm font-semibold">
          {props.title}
        </span>
        {props.meta ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{props.meta}</span>
        ) : null}
        <span className="ms-auto flex shrink-0 items-center gap-1">{props.action}</span>
      </div>
      {props.children}
    </section>
  )
}

/** 计划条目：状态图标 + 完成态删除线（与 goose 的 plan 事件同形） */
function PlanEntryList(props: {
  entries: NonNullable<ReturnType<typeof findLatestPlan>>['entries']
}) {
  const items = useMemo(
    function () {
      return props.entries.map(function (entry) {
        return { content: entry.content, status: entry.status }
      })
    },
    [props.entries]
  )
  return <TodoList items={items} />
}

/** 元信息小标签：统一一档字号与圆角，避免每个分区各写一套 */
function Chip(props: { icon: string; children: ReactNode; tone?: 'muted' | 'violet' | 'sky' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs leading-none',
        props.tone === 'violet'
          ? 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300'
          : props.tone === 'sky'
            ? 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300'
            : 'border-border/60 bg-muted/50 text-muted-foreground'
      )}>
      <Icon
        icon={props.icon}
        className="size-3 shrink-0"
      />
      {props.children}
    </span>
  )
}

/**
 * 顶部状态卡：**先回答「在不在跑」，再回答「在跑什么」，最后给动作**。
 *
 * 之前只有一行 12px 文字 + 一个小命令胶囊：右栏窄、字小，用户根本判断不出
 * agent 到底还在不在动，只能去终端里瞎找。现在：状态用 15px + 呼吸点，
 * 当前命令独占一行（等宽、可点进终端），跑着的时候右侧直接给「停止」。
 */
function StatusHero(props: {
  isRunning: boolean
  runningCommand: SessionCommandState | null
  updatedLabel: string | null
  goalTurnLabel: string | null
  onOpenTerminal: () => void
  onStop: () => void
}) {
  const command = props.isRunning ? props.runningCommand : null
  return (
    <div
      className={clsx(
        'flex shrink-0 flex-col gap-2 border-b px-3 py-2.5',
        props.isRunning
          ? 'border-emerald-500/25 bg-emerald-500/8'
          : 'border-border/60 bg-muted/25'
      )}>
      <div className="flex min-w-0 items-center gap-2">
        {/* 呼吸点：静止时不闪，避免「空闲」看起来也在跑 */}
        <span
          aria-hidden
          className="relative flex size-2.5 shrink-0 items-center justify-center">
          {props.isRunning ? (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/40" />
          ) : null}
          <span
            className={clsx(
              'relative inline-flex size-2.5 rounded-full',
              props.isRunning ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            )}
          />
        </span>
        <span
          className={clsx(
            'shrink-0 text-[15px] leading-none font-semibold',
            props.isRunning ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground/80'
          )}>
          {props.isRunning ? '正在执行' : '已空闲'}
        </span>
        {props.goalTurnLabel ? (
          <Chip
            icon="lucide:target"
            tone="violet">
            {props.goalTurnLabel}
          </Chip>
        ) : null}
        <span className="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
          {props.isRunning
            ? command
              ? formatToolElapsed(command.elapsedMs)
              : ''
            : props.updatedLabel
              ? `最后更新 ${props.updatedLabel}`
              : '等待你的下一条消息'}
        </span>
        {props.isRunning ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="停止这一轮"
            title="停止这一轮（已跑的命令不会被回滚）"
            className="text-muted-foreground hover:text-destructive size-6 shrink-0"
            onClick={props.onStop}>
            <Icon
              icon="lucide:square"
              className="size-2.5 fill-current"
            />
          </Button>
        ) : null}
      </div>

      {command ? (
        <button
          type="button"
          title={`在终端里看这条命令：${command.command}`}
          onClick={props.onOpenTerminal}
          className="bg-background/80 hover:bg-background flex min-w-0 items-center gap-2 rounded-lg border border-emerald-500/25 px-2.5 py-1.5 text-start transition-colors">
          <Icon
            icon="lucide:terminal"
            className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
          <span className="text-foreground min-w-0 flex-1 truncate font-mono text-[13px]">
            {command.command}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs">看终端</span>
          <Icon
            icon="lucide:chevron-right"
            className="text-muted-foreground/60 size-3.5 shrink-0"
          />
        </button>
      ) : null}
    </div>
  )
}

/** 会话分区：最后一条用户消息的摘要 + 模型 / 审批 / 模式 */
function SessionSection(props: {
  summary: string
  modelLabel: string
  approvalLabel: string
  modeLabel: string
  modeIcon: string
  messageCount: number
  toolCount: number
  usageLabel: string | null
}) {
  return (
    <Section
      icon="lucide:message-square"
      iconClass="text-primary"
      title="本轮概要"
      meta={`${props.messageCount} 条消息`}
      action={
        props.usageLabel ? (
          <Chip icon="lucide:database">{props.usageLabel}</Chip>
        ) : undefined
      }>
      <p className="text-foreground/90 line-clamp-4 text-sm leading-relaxed">
        {props.summary}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Chip icon={props.modeIcon}>{props.modeLabel}</Chip>
        <Chip icon="lucide:box">{props.modelLabel}</Chip>
        <Chip icon="lucide:shield-check">{props.approvalLabel}</Chip>
        {props.toolCount > 0 ? (
          <Chip icon="lucide:wrench">{props.toolCount} 次工具</Chip>
        ) : null}
      </div>
    </Section>
  )
}

/** 工作区分区：根路径、git 分支与附加目录 */
function WorkspaceSection(props: {
  title: string
  rootPath: string | null
  probe: ProbeR | null
  extraFolders: ReadonlyArray<{ id: string; path: string }>
  onBrowse: () => void
}) {
  const branch = props.probe?.isRepo ? props.probe.branch : null
  return (
    <Section
      icon="lucide:folder"
      iconClass="text-amber-500"
      title="工作区"
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="浏览文件树"
          title="浏览文件树"
          className="text-muted-foreground hover:text-foreground size-6"
          onClick={props.onBrowse}>
          <Icon
            icon="lucide:folder-tree"
            className="size-3.5"
          />
        </Button>
      }>
      <div className="min-w-0">
        <p className="text-foreground truncate text-sm font-medium">{props.title}</p>
        {props.rootPath ? (
          <p
            className="text-muted-foreground mt-0.5 truncate font-mono text-xs"
            title={props.rootPath}>
            {truncatePath(props.rootPath)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip icon="lucide:monitor">本地</Chip>
        {branch ? <Chip icon="lucide:git-branch">{branch}</Chip> : null}
        {props.extraFolders.length > 0 ? (
          <Chip icon="lucide:folders">
            +{props.extraFolders.length} 个目录
          </Chip>
        ) : null}
      </div>
      {props.extraFolders.length > 0 ? (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {props.extraFolders.slice(0, 4).map(function (folder) {
            return (
              <li
                key={folder.id}
                className="truncate font-mono"
                title={folder.path}>
                {truncatePath(folder.path, 36)}
              </li>
            )
          })}
        </ul>
      ) : null}
    </Section>
  )
}

/** 产出分区：本会话改过的文件（带 git 状态徽标），点开可对比 */
function OutputSection(props: {
  rows: readonly AsideOutputRow[]
  onOpenFile: (relative: string) => void
  onOpenReview: () => void
}) {
  return (
    <Section
      icon="lucide:package"
      iconClass="text-emerald-500"
      title="产出"
      meta={props.rows.length > 0 ? `${props.rows.length} 个文件` : undefined}
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="打开审阅"
          title="打开审阅"
          className="text-muted-foreground hover:text-foreground size-6"
          onClick={props.onOpenReview}>
          <Icon
            icon="lucide:git-compare"
            className="size-3.5"
          />
        </Button>
      }>
      {props.rows.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {props.rows.map(function (row) {
            return (
              <li key={row.path}>
                <button
                  type="button"
                  title={row.path}
                  onClick={function () {
                    props.onOpenFile(row.path)
                  }}
                  className="hover:bg-muted/60 flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors">
                  <span
                    className={clsx(
                      'w-4 shrink-0 text-center font-mono text-xs font-semibold',
                      row.badge ? 'text-primary' : 'text-muted-foreground/60'
                    )}>
                    {row.badge ?? '·'}
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                    {findBaseName(row.path)}
                  </span>
                  <span className="text-muted-foreground max-w-[45%] truncate text-xs opacity-70">
                    {row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs leading-relaxed">
          代理改写文件后会显示在这里，点一行打开对比
        </p>
      )}
    </Section>
  )
}

/** 来源分区：Elements Sources + 文件树入口 */
function SourcesSection(props: {
  names: readonly string[]
  onBrowse: () => void
  onOpenFile: (name: string) => void
}) {
  return (
    <Section
      icon="lucide:paperclip"
      iconClass="text-sky-500"
      title="来源"
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="从文件树添加"
          title="从文件树添加"
          className="text-muted-foreground hover:text-foreground size-6"
          onClick={props.onBrowse}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
        </Button>
      }>
      {props.names.length > 0 ? (
        <Sources
          defaultOpen
          className="text-foreground mb-0">
          <SourcesTrigger
            count={props.names.length}
            className="text-muted-foreground hover:text-foreground text-xs">
            <p className="font-medium">{`已引用 ${props.names.length} 个来源`}</p>
            <Icon
              icon="lucide:chevron-down"
              className="size-3.5"
            />
          </SourcesTrigger>
          <SourcesContent className="mt-2 w-full">
            {props.names.map(function (name) {
              return (
                <Source
                  key={name}
                  href={`#${encodeURIComponent(name)}`}
                  title={name}
                  className="text-foreground hover:bg-muted/60 flex w-full items-center justify-start gap-2 rounded-md px-1.5 py-1.5 text-[13px] leading-snug no-underline"
                  onClick={function (event) {
                    event.preventDefault()
                    props.onOpenFile(name)
                  }}>
                  <Icon
                    icon="lucide:file"
                    className="text-muted-foreground size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-start">{name}</span>
                </Source>
              )
            })}
          </SourcesContent>
        </Sources>
      ) : (
        <p className="text-muted-foreground text-xs">暂无来源；用输入框的 + 引用工作区文件</p>
      )}
    </Section>
  )
}

/**
 * 计划草稿：标题 + 概述 + 前 3 步做速览，完整正文与「开始执行」都在「计划」页签。
 * 不再整段铺清单 —— 清单只是正文的摘要，铺开会把右栏撑满又说不清细节。
 */
function PlanDraftBlock(props: { draft: PlanDraft; onOpenPlan?: () => void }) {
  const preview = props.draft.steps.slice(0, 3)
  const rest = props.draft.steps.length - preview.length

  return (
    <div className="flex flex-col gap-1.5">
      {props.draft.title ? (
        <p className="text-foreground truncate text-[13px] font-medium">{props.draft.title}</p>
      ) : null}
      {props.draft.overview ? (
        <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
          {props.draft.overview}
        </p>
      ) : null}
      {preview.length > 0 ? (
        <ol className="text-muted-foreground flex flex-col gap-1 text-xs">
          {preview.map(function (step, index) {
            return (
              <li
                key={step}
                className="flex min-w-0 gap-1.5">
                <span className="shrink-0 tabular-nums opacity-60">{index + 1}.</span>
                <span className="truncate">{step}</span>
              </li>
            )
          })}
        </ol>
      ) : null}
      <div className="flex items-center gap-1.5">
        {rest > 0 ? (
          <span className="text-muted-foreground text-xs opacity-70">还有 {rest} 步</span>
        ) : null}
        {props.onOpenPlan ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="ms-auto h-5 gap-1 px-0 text-xs"
            onClick={props.onOpenPlan}>
            查看完整计划
            <Icon
              icon="lucide:arrow-right"
              className="size-3"
            />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function findCommandStatus(status: SessionCommandState['status']): {
  icon: string
  className: string
  label: string
} {
  if (status === 'running') {
    return {
      icon: 'lucide:loader-circle',
      className: 'text-terminal-accent animate-spin',
      label: '执行中'
    }
  }
  if (status === 'error') {
    return { icon: 'lucide:x', className: 'text-destructive', label: '失败' }
  }
  if (status === 'waiting') {
    return {
      icon: 'lucide:circle-pause',
      className: 'text-amber-500',
      label: '等待'
    }
  }
  if (status === 'interrupted') {
    return { icon: 'lucide:circle-slash', className: 'text-muted-foreground', label: '已中断' }
  }
  return { icon: 'lucide:check', className: 'text-emerald-500', label: '完成' }
}

/** 一行命令：状态在前、命令居中、耗时在右，整行点进终端 */
function CommandRow(props: {
  command: SessionCommandState
  onOpenTerminal: (
    command: string,
    workdir?: string | null,
    source?: SessionCommandState['source']
  ) => void
}) {
  const status = findCommandStatus(props.command.status)
  const isRunning = props.command.status === 'running'
  const isExternal = props.command.source === 'external'
  return (
    <li className="shrink-0">
      <button
        type="button"
        title={
          isExternal
            ? `非面板终端 · ${status.label} · ${props.command.command}`
            : `${status.label} · ${props.command.command}`
        }
        onClick={function () {
          props.onOpenTerminal(
            props.command.command,
            props.command.workdir,
            props.command.source
          )
        }}
        className={clsx(
          'flex w-full min-w-0 flex-col gap-1 rounded-lg border px-2.5 py-2 text-start transition-colors',
          isRunning
            ? 'border-emerald-500/25 bg-emerald-500/8 hover:bg-emerald-500/12'
            : 'hover:bg-muted/60 border-transparent bg-muted/30'
        )}>
        <div className="flex w-full min-w-0 items-center gap-2">
          <Icon
            icon={status.icon}
            className={clsx('size-3.5 shrink-0', status.className)}
            aria-label={status.label}
          />
          <span
            className={clsx(
              'shrink-0 text-xs font-medium',
              isRunning ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'
            )}>
            {status.label}
          </span>
          <span className="text-foreground min-w-0 flex-1 truncate font-mono text-[13px]">
            {props.command.command}
          </span>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {formatToolElapsed(props.command.elapsedMs)}
          </span>
          <Icon
            icon="lucide:chevron-right"
            className="text-muted-foreground/60 size-3.5 shrink-0"
          />
        </div>
        {props.command.workdir || props.command.background || isExternal ? (
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 ps-5.5 text-xs">
            {isExternal ? (
              <span className="border-border bg-background/60 shrink-0 rounded-full border px-1.5 py-px text-[10px]">
                非面板终端
              </span>
            ) : null}
            {props.command.background ? (
              <span className="border-border bg-background/60 shrink-0 rounded-full border px-1.5 py-px text-[10px]">
                后台
              </span>
            ) : null}
            {props.command.workdir ? (
              <span className="min-w-0 truncate font-mono">
                {truncatePath(props.command.workdir, 48)}
              </span>
            ) : null}
          </div>
        ) : null}
      </button>
    </li>
  )
}

/**
 * 命令执行区：**执行中 / 等待** 单独置顶（这是「在不在跑」的答案），
 * 已结束的收进可折叠列表 —— 一轮跑十几条命令时，历史会把真正在跑的那条挤出视野。
 */
function CommandsSection(props: {
  commands: readonly SessionCommandState[]
  onOpenTerminal: (
    command: string,
    workdir?: string | null,
    source?: SessionCommandState['source']
  ) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const running = props.commands.filter(function (command) {
    return command.status === 'running'
  })
  const waiting = props.commands.filter(function (command) {
    return command.status === 'waiting'
  })
  const finished = props.commands.filter(function (command) {
    return command.status !== 'running' && command.status !== 'waiting'
  })
  const [historyOverride, updateHistoryOpen] = useState<boolean | null>(null)
  /** 默认：有在跑的就收起历史；全空了就展开，方便回看上一批命令 */
  const historyOpen = historyOverride ?? running.length + waiting.length === 0

  useEffect(
    function () {
      const node = listRef.current
      if (!node) return
      node.scrollTop = node.scrollHeight
    },
    [running.length, waiting.length]
  )

  return (
    <Section
      icon="lucide:square-terminal"
      iconClass="text-terminal-accent"
      title="命令"
      meta={
        props.commands.length > 0
          ? running.length > 0
            ? `${running.length} 个执行中`
            : `共 ${props.commands.length} 条`
          : undefined
      }
      action={
        props.commands.length > 0 ? (
          <span className="text-muted-foreground/70 shrink-0 text-xs">点一行看终端</span>
        ) : undefined
      }>
      {props.commands.length === 0 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          agent 执行 shell 时显示在这里；命令行可点，直接跳到对应终端
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {running.length + waiting.length > 0 ? (
            <ul
              ref={listRef}
              className="overscroll-y-contain -mx-1 flex max-h-[min(20rem,38vh)] flex-col gap-1 overflow-x-hidden overflow-y-auto px-1">
              {[...running, ...waiting].map(function (command) {
                return (
                  <CommandRow
                    key={command.toolCallId}
                    command={command}
                    onOpenTerminal={props.onOpenTerminal}
                  />
                )
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs leading-relaxed">
              当前没有命令在执行；这一轮的 {finished.length} 条已结束命令收在下面
            </p>
          )}

          {finished.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                aria-expanded={historyOpen}
                onClick={function () {
                  updateHistoryOpen(!historyOpen)
                }}
                className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-start text-xs transition-colors">
                <Icon
                  icon={historyOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
                  className="size-3.5 shrink-0"
                />
                <span>本轮已结束 {finished.length} 条</span>
              </button>
              {historyOpen ? (
                <ul className="overscroll-y-contain -mx-1 flex max-h-[min(22rem,42vh)] flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-1">
                  {finished.map(function (command) {
                    return (
                      <CommandRow
                        key={command.toolCallId}
                        command={command}
                        onOpenTerminal={props.onOpenTerminal}
                      />
                    )
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  )
}

/**
 * 后台终端会话：刷新 WebView / 重开面板后，zustand 是空的但 Rust PTY 还在。
 * 这里直接列出来，点一行激活、点 × 关闭 —— 否则用户「看不到也关不掉」。
 *
 * 关闭按钮**不做 hover 才显形**：右栏可能跑在触摸屏 / 远程桌面上，hover 不出来就等于没有。
 */
function TerminalsSection(props: { onOpenTerminal: () => void }) {
  const tabs = useTerminalStore(function (state) {
    return state.tabs
  })
  const activeId = useTerminalStore(function (state) {
    return state.activeId
  })
  const [isSyncing, updateSyncing] = useState(false)

  if (tabs.length === 0) return null

  function open(id: string) {
    useTerminalStore.getState().writeActive(id)
    useTerminalStore.getState().openPanel()
    props.onOpenTerminal()
  }

  function sync() {
    updateSyncing(true)
    void bootstrapTerminalSessions().finally(function () {
      updateSyncing(false)
    })
  }

  return (
    <Section
      icon="lucide:terminal"
      iconClass="text-terminal-accent"
      title="终端会话"
      meta={`${tabs.length} 个`}
      action={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="同步后台会话"
            title="同步：把仍然存活的后台终端会话捞回来"
            className="text-muted-foreground hover:text-foreground size-6"
            disabled={isSyncing}
            onClick={sync}>
            <Icon
              icon="lucide:refresh-cw"
              className={clsx('size-3.5', isSyncing && 'animate-spin')}
            />
          </Button>
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-5 px-1 text-xs"
            onClick={props.onOpenTerminal}>
            打开
          </Button>
        </>
      }>
      <ul className="flex flex-col gap-0.5">
        {tabs.map(function (tab) {
          const isAgent = tab.origin === 'agent'
          return (
            <li
              key={tab.id}
              className={clsx(
                'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5',
                tab.id === activeId ? 'bg-muted/70' : 'hover:bg-muted/45'
              )}>
              <Icon
                icon={isAgent ? 'lucide:bot' : 'lucide:terminal'}
                className={clsx(
                  'size-4 shrink-0',
                  isAgent ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              <button
                type="button"
                title={`${tab.title}\n${tab.cwd}`}
                onClick={function () {
                  open(tab.id)
                }}
                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start">
                <span className="text-foreground w-full truncate text-sm">{tab.title}</span>
                <span className="text-muted-foreground flex w-full min-w-0 items-center gap-1.5 text-xs">
                  <span
                    className={clsx(
                      'size-1.5 shrink-0 rounded-full',
                      tab.exited ? 'bg-muted-foreground/40' : 'bg-emerald-500'
                    )}
                  />
                  <span
                    className={clsx(
                      'shrink-0',
                      tab.exited ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'
                    )}>
                    {tab.exited ? '已退出' : '运行中'}
                  </span>
                  <span className="min-w-0 truncate font-mono opacity-70">
                    {truncatePath(tab.cwd, 36)}
                  </span>
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭这个终端"
                title="关闭这个终端（会终止里面的进程）"
                className="text-muted-foreground hover:text-destructive size-6 shrink-0"
                onClick={function () {
                  void Terminal.kill(tab.id).catch(function (error: unknown) {
                    console.warn('[agent/aside] 关闭终端失败:', error)
                  })
                  useTerminalStore.getState().removeTab(tab.id)
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-3.5"
                />
              </Button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function AsideBusy(props: AsideBusyProps) {
  const aui = useAui()
  const { workspace, rootPath, folders } = useActiveWorkspace()
  const [probeState, updateProbe] = useState<ProbeR | null>(null)
  /** 没有工作区时一律按「无仓库」渲染：不在 effect 里同步清 state */
  const probe = rootPath ? probeState : null
  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })
  const activeProvider = providers.find(function (provider) {
    return provider.id === activeProviderID && provider.enabled
  })
  const approval = findApprovalPolicy(readApprovalMode())
  const agentModeKey = useSyncExternalStore(subscribeAgentMode, readAgentMode, readAgentMode)
  const agentMode = findAgentMode(agentModeKey)
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const goalRun = useGoalRun(threadID)
  const goalTurnLabel =
    goalRun !== null
      ? `第 ${Math.min(goalRun.used + 1, goalRun.budget)}/${goalRun.budget} 轮`
      : null

  /**
   * 详情面板按**结构**订阅 messages：正文逐 token 增长，不影响工具路径 / 计划条目 / 来源，
   * 没必要把这块上千行的面板拖进每一帧。计划草稿要看正文，交给 `PlanSection` 自己订阅。
   */
  const messages = useStructuralThreadMessages()
  const composerAttachments = useAuiState(function (state) {
    return state.composer.attachments
  })

  const summary = useMemo(
    function () {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message.role !== 'user') continue
        const text = message.content
          .filter(function (part) {
            return part.type === 'text'
          })
          .map(function (part) {
            return part.type === 'text' ? part.text : ''
          })
          .join('')
          .trim()
        if (text) return text.length > 120 ? `${text.slice(0, 120)}…` : text
      }
      return '进行中'
    },
    [messages]
  )

  const updatedLabel = useMemo(
    function () {
      const last = messages[messages.length - 1]
      const createdAt = last?.createdAt
      if (!createdAt) return null
      const date = createdAt instanceof Date ? createdAt : new Date(createdAt)
      if (Number.isNaN(date.getTime())) return null
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    [messages]
  )

  const sourceNames = useMemo(
    function () {
      const names: string[] = []
      for (const attachment of composerAttachments) {
        if (attachment.name) names.push(attachment.name)
      }
      for (const message of messages) {
        if (message.role !== 'user') continue
        for (const part of message.content) {
          if (part.type === 'file' && part.filename) names.push(part.filename)
          if (part.type === 'image' && 'filename' in part && part.filename) {
            names.push(String(part.filename))
          }
        }
      }
      return [...new Set(names)].slice(0, 12)
    },
    [composerAttachments, messages]
  )

  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const sessionCommands = useSessionCommands()
  const runningCommand =
    sessionCommands.find(function (command) {
      return command.status === 'running'
    }) ?? null
  const gitSnapshot = useWorkspaceGitSnapshot(rootPath)
  const mainThreadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const usage = useSyncExternalStore(
    subscribeGooseUsage,
    function () {
      return findGooseUsage(mainThreadID)
    },
    function () {
      return findGooseUsage(mainThreadID)
    }
  )
  const toolCount = useMemo(
    function () {
      let count = 0
      for (const message of messages) {
        for (const part of message.content) {
          if (part.type === 'tool-call') count += 1
        }
      }
      return count
    },
    [messages]
  )
  // git status 只在「跑完一轮」后重查：运行中频繁查没意义，列表也会闪
  const wasRunning = useRef(isRunning)
  useEffect(
    function () {
      if (wasRunning.current && !isRunning) void refreshNow(rootPath)
      wasRunning.current = isRunning
    },
    [isRunning, rootPath]
  )
  const status = gitSnapshot

  const badgeByPath = useMemo(
    function () {
      const map = new Map<string, string | null>()
      const groups = groupEntries(status.entries)
      for (const entry of [...groups.staged, ...groups.changed, ...groups.untracked]) {
        if (map.has(entry.path)) continue
        map.set(entry.path, findStatusBadge(entry))
      }
      return map
    },
    [status.entries]
  )

  const outputs = useMemo(
    function () {
      return collectToolPaths(messages, rootPath)
        .map(function (hit) {
          return { path: hit.path, badge: badgeByPath.get(hit.path) ?? null }
        })
        .slice(0, 24)
    },
    [messages, rootPath, badgeByPath]
  )

  const extraFolders = folders.slice(1)

  useEffect(
    function () {
      if (!rootPath) return
      let cancelled = false
      void invoke<ProbeR>(CHANNELS.WORKSPACE_GIT.PROBE, { params: { path: rootPath } })
        .then(function (result) {
          if (!cancelled) updateProbe(result)
        })
        .catch(function () {
          if (!cancelled) updateProbe(null)
        })
      return function () {
        cancelled = true
      }
    },
    [rootPath]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StatusHero
        isRunning={isRunning}
        runningCommand={runningCommand}
        updatedLabel={updatedLabel}
        goalTurnLabel={goalTurnLabel}
        onOpenTerminal={function () {
          props.onOpenTerminal(
            runningCommand?.command ?? '',
            runningCommand?.workdir ?? null,
            runningCommand?.source
          )
        }}
        onStop={function () {
          aui.thread.cancelRun()
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain p-3">
        <SessionSection
          summary={summary}
          modelLabel={activeProvider?.model?.trim() || '未选模型'}
          approvalLabel={approval?.label ?? '询问审批'}
          modeLabel={agentMode.label}
          modeIcon={agentMode.icon}
          messageCount={messages.length}
          toolCount={toolCount}
          usageLabel={usage && usage.size > 0 ? formatGooseUsage(usage) : null}
        />

        <CommandsSection
          commands={sessionCommands}
          onOpenTerminal={props.onOpenTerminal}
        />

        <TerminalsSection
          onOpenTerminal={function () {
            props.onOpenTerminal('', null)
          }}
        />

        <WorkspaceSection
          title={workspace?.title ?? '未选择工作区'}
          rootPath={rootPath}
          probe={probe}
          extraFolders={extraFolders}
          onBrowse={function () {
            props.onOpenFiles()
          }}
        />

        <PlanSection
          threadID={mainThreadID}
          rootPath={rootPath}
          workspaceTitle={workspace?.title ?? ''}
          isRunning={isRunning}
          isPlanMode={props.isPlanMode}
          onOpenPlan={props.onOpenPlan}
        />

        <OutputSection
          rows={outputs}
          onOpenFile={function (relative) {
            props.onOpenReview(relative)
          }}
          onOpenReview={function () {
            props.onOpenReview()
          }}
        />

        <SourcesSection
          names={sourceNames}
          onBrowse={function () {
            props.onOpenFiles()
          }}
          onOpenFile={function (name) {
            props.onOpenFiles(name)
          }}
        />
      </div>
    </div>
  )
}

/**
 * 计划卡：详情面板里**唯一**需要正文的区块。
 *
 * 草稿是从回答正文里抽出来的，所以这一块自己订阅 `thread.messages`（逐 token 才有意义）；
 * 面板其余分区按结构订阅，流式时不再整体重渲染。
 */
function PlanSection(props: {
  threadID: string | null
  rootPath: string | null
  workspaceTitle: string
  isRunning: boolean
  isPlanMode: boolean
  onOpenPlan?: () => void
}) {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const plan = useMemo(
    function () {
      return findLatestPlan(messages)
    },
    [messages]
  )
  /** 档案优先：计划不会因为后续问答消失；没有档案才退回「从正文抽草稿」 */
  const storedPlan = usePlanRecord(props.threadID)
  const planDraft = useMemo(
    function () {
      if (plan && plan.entries.length > 0) return null
      if (storedPlan) {
        return {
          title: storedPlan.title,
          overview: storedPlan.overview,
          steps: storedPlan.steps,
          body: storedPlan.body
        }
      }
      return findPlanDraft(messages)
    },
    [messages, plan, storedPlan]
  )
  /** 两份来源归一：保存与展示用同一串步骤 */
  const planSteps = useMemo(
    function () {
      if (plan && plan.entries.length > 0) {
        return plan.entries.map(function (entry) {
          return entry.content
        })
      }
      return planDraft?.steps ?? []
    },
    [plan, planDraft]
  )

  async function handleSavePlan() {
    if (!props.rootPath) {
      toast.error('先在左栏添加一个工作区')
      return
    }
    try {
      const relative = await savePlanToWorkspace(props.rootPath, {
        title: planDraft?.title || props.workspaceTitle || '计划',
        overview: planDraft?.overview ?? '',
        steps: planSteps,
        body: planDraft?.body ?? ''
      })
      toast.success(`计划已保存到 ${relative}`)
    } catch (error) {
      console.warn('[agent/aside] 保存计划失败:', error)
      toast.error(error instanceof Error ? error.message : '保存计划失败')
    }
  }

  return (
    <Section
      icon="lucide:list-todo"
      iconClass="text-violet-500"
      title={plan && plan.total > 0 ? '计划' : planDraft ? '计划草稿' : '计划'}
      meta={
        plan && plan.total > 0
          ? `${plan.done}/${plan.total}`
          : planDraft
            ? `${planDraft.steps.length} 步`
            : undefined
      }
      action={
        planSteps.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="保存计划到工作区"
            title="保存到 .cogito/plans"
            className="text-muted-foreground hover:text-foreground size-6"
            onClick={function () {
              void handleSavePlan()
            }}>
            <Icon
              icon="lucide:save"
              className="size-3.5"
            />
          </Button>
        ) : undefined
      }>
      {plan && plan.entries.length > 0 ? (
        <PlanEntryList entries={plan.entries} />
      ) : planDraft ? (
        <PlanDraftBlock
          draft={planDraft}
          onOpenPlan={props.onOpenPlan}
        />
      ) : (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {props.isPlanMode
            ? props.isRunning
              ? '等待模型按骨架产出 Markdown 计划…'
              : messages.some(function (message) {
                    return message.role === 'user'
                  })
                ? '本轮未按计划骨架输出（需含概述 / 实施步骤等章节）'
                : '发出需求后，模型产出的计划会显示在这里'
            : '暂无计划'}
        </p>
      )}
    </Section>
  )
}

export { AsideBusy }
