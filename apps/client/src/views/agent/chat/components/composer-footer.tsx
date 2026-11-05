/**
 * 输入框下方：左工作区 · 右本机运行 / 分支 / 上下文用量。
 */
import { Icon } from '@iconify/react/offline'
import { useAui, useAuiState } from '@assistant-ui/react'
import { Button } from '@cogito/design/components/button'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextCacheUsage,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextSourceUsage,
  ContextTrigger
} from '@cogito/design/assistant/context'
import { cn } from 'cn'
import { useMemo, useSyncExternalStore } from 'react'

import {
  findGooseUsage,
  formatGooseUsage,
  formatTokenCount,
  subscribeGooseUsage,
  type GooseUsage
} from '@/features/agent/acp/goose-usage'
import { estimateContextBreakdown } from '@/features/agent/context-estimate'
import { findSystemPrompt } from '@/features/agent/model/prompts'
import { buildPromptContext } from '@/features/agent/model/prompt-context'
import { findActiveScenario } from '@/features/agent/model/active-scenario'
import {
  appendModeGuidance,
  readAgentMode,
  subscribeAgentMode
} from '@/features/agent/mode'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { checkoutNow, useWorkspaceGitSnapshot } from '@/features/agent/workspace/git.ts'
import { useGoalRecord } from '@/features/agent/plan-store'
import { useAgentStore } from '@/stores/agent.ts'
import { BranchSwitcherView } from '@/views/code/workspace/scm/branch-switcher-view.tsx'
import { findBaseName } from '@/views/agent/chat/components/workspace-relative-path.ts'
import {
  buildContinuePrompt,
  GOAL_BUDGET_OPTIONS,
  readNextGoalBudget,
  rememberGoalPrompt,
  resumeGoalRun,
  stopGoalRun,
  subscribeGoalBudget,
  useGoalRun,
  writeNextGoalBudget
} from '@/features/agent/goal-run'

const FALLBACK_MAX_TOKENS = 128_000

function useContextUsage(): GooseUsage | null {
  const activeThreadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  return useSyncExternalStore(
    subscribeGooseUsage,
    function () {
      return findGooseUsage(activeThreadID)
    }
  )
}

/** footer 右侧用量：无 ACP 数据时仍显示入口；展开含来源分段 + I/O */
function UsageDisplay() {
  const usage = useContextUsage()
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })

  const breakdown = useMemo(
    function () {
      const scenario = findActiveScenario()
      const promptScenario =
        readAgentMode() === 'plan' && scenario === 'plan' ? 'general' : scenario
      const systemText = appendModeGuidance(
        findSystemPrompt(promptScenario, buildPromptContext())
      )
      return estimateContextBreakdown({ systemText, messages })
    },
    [messages]
  )

  const used = usage?.used ?? 0
  const max = usage && usage.size > 0 ? usage.size : FALLBACK_MAX_TOKENS
  const label =
    usage && usage.size > 0
      ? formatGooseUsage(usage)
      : `${formatTokenCount(used)} / ${formatTokenCount(max)}`
  const nearFull = max > 0 && used / max >= 0.85

  return (
    <Context
      usedTokens={used}
      maxTokens={max}
      usage={{
        ...breakdown,
        inputTokens: used > 0 ? used : undefined
      }}>
      <ContextTrigger>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 shrink-0 gap-1 rounded-md px-2.5 text-xs',
            nearFull
              ? 'text-destructive hover:text-destructive'
              : 'text-muted-foreground hover:text-foreground'
          )}
          title={
            usage && usage.size > 0
              ? `上下文窗口 ${label}`
              : '上下文用量（尚未收到会话统计，以下为估算）'
          }>
          <Icon
            icon="lucide:database"
            className="size-3 shrink-0"
          />
          {/* 显式写出「上下文」：只放一个数据库图标 + 数字，用户认不出这是什么 */}
          <span className="whitespace-nowrap">上下文</span>
          <span className="font-mono tabular-nums">{label ?? '—'}</span>
        </Button>
      </ContextTrigger>
      <ContextContent
        align="end"
        side="top"
        sideOffset={8}>
        <ContextContentHeader />
        <ContextContentBody className="space-y-2">
          <p className="text-muted-foreground text-[11px]">来源（估算）</p>
          <ContextSourceUsage />
          <p className="text-muted-foreground pt-1 text-[11px]">用量</p>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextReasoningUsage />
          <ContextCacheUsage />
        </ContextContentBody>
      </ContextContent>
    </Context>
  )
}

function WorkspaceMenu() {
  const { workspace, workspaceID, rootPath, folders, selectRoot } = useActiveWorkspace()
  const workspaces = useAgentStore(function (state) {
    return state.workspaces
  })
  const currentFolderName =
    rootPath && folders.length > 1 ? findBaseName(rootPath) : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="切换工作区或文件夹"
            title={rootPath ?? '还没有选择工作区'}
            className="text-muted-foreground hover:text-foreground h-7 max-w-50 min-w-0 gap-1.5 rounded-md px-2.5 text-xs"
          />
        }>
        <Icon
          icon="lucide:folder"
          className="size-3 shrink-0"
        />
        <span className="min-w-0 truncate">{workspace?.title ?? '未选择工作区'}</span>
        {currentFolderName ? (
          <span className="text-muted-foreground/80 min-w-0 truncate">/ {currentFolderName}</span>
        ) : null}
        <Icon
          icon="lucide:chevrons-up-down"
          className="size-3 shrink-0 opacity-55"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="max-h-80 w-auto min-w-56 max-w-80 overflow-y-auto p-1">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
            工作区
          </DropdownMenuLabel>
          {workspaces.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">还没有工作区</p>
          ) : null}
          {workspaces.map(function (item) {
            const isActive = item.id === workspaceID
            return (
              <DropdownMenuItem
                key={item.id}
                title={item.title}
                className={cn('gap-2 rounded-sm px-2 py-2 text-sm', isActive && 'bg-accent/60')}
                onClick={function () {
                  if (isActive) return
                  useAgentStore.getState().toActivateWorkspace(item.id)
                }}>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <Icon
                  icon="lucide:check"
                  className={cn(
                    'ml-auto size-4 shrink-0',
                    isActive ? 'text-primary opacity-100' : 'opacity-0'
                  )}
                />
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>

        {folders.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wide uppercase">
                文件夹
              </DropdownMenuLabel>
              {folders.map(function (folder) {
                const isActive = folder.path === rootPath
                return (
                  <DropdownMenuItem
                    key={folder.id}
                    title={folder.path}
                    className={cn('gap-2 rounded-sm px-2 py-2 text-sm', isActive && 'bg-accent/60')}
                    onClick={function () {
                      if (isActive) return
                      selectRoot(folder.path)
                    }}>
                    <Icon
                      icon="lucide:folder"
                      className="text-muted-foreground size-4 shrink-0 opacity-70"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {findBaseName(folder.path)}
                    </span>
                    <Icon
                      icon="lucide:check"
                      className={cn(
                        'ml-auto size-4 shrink-0',
                        isActive ? 'text-primary opacity-100' : 'opacity-0'
                      )}
                    />
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 目标模式专用：轮次预算 / 当前进度 / 立即停止。
 *
 * 「轮次」是**每次发送**的输入项（这条任务最多自动推进几轮），所以它只在目标模式下出现，
 * 且在发送前可调 —— 以前它藏在计划页，「直接发目标」根本没有入口。
 */
function GoalTurnControl() {
  const aui = useAui()
  const mode = useSyncExternalStore(subscribeAgentMode, readAgentMode, readAgentMode)
  const budget = useSyncExternalStore(subscribeGoalBudget, readNextGoalBudget, readNextGoalBudget)
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const run = useGoalRun(threadID)
  /** 结束后的三态（已完成 / 已暂停 / 已用尽）来自档案，不能再靠内存里的 run */
  const record = useGoalRecord(threadID)

  if (mode !== 'goal') return null

  if (!run) {
    if (record && record.status !== 'running') {
      const meta =
        record.status === 'done'
          ? {
              icon: 'lucide:check',
              label: `已完成 · ${record.used}/${record.budget} 轮`,
              tone: 'text-emerald-700 dark:text-emerald-300'
            }
          : record.status === 'paused'
            ? {
                icon: 'lucide:pause',
                label: `已暂停 · ${record.used}/${record.budget} 轮`,
                tone: 'text-amber-700 dark:text-amber-300'
              }
            : {
                icon: 'lucide:circle-slash',
                label: `已用尽 · ${record.used}/${record.budget} 轮`,
                tone: 'text-muted-foreground'
              }
      const canResume = record.status === 'paused' || record.status === 'exhausted'
      return (
        <div className="border-border/60 bg-muted/40 flex h-7 shrink-0 items-center gap-1 rounded-md border px-1.5">
          <Icon
            icon={meta.icon}
            className="size-3 shrink-0"
          />
          <span className={`text-xs font-medium tabular-nums ${meta.tone}`}>{meta.label}</span>
          {canResume && threadID ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="继续推进目标"
              title="重置轮次并继续自动推进"
              className="text-violet-700 hover:text-violet-800 dark:text-violet-300 h-5 shrink-0 gap-0.5 px-1 text-[11px]"
              onClick={function () {
                const next = resumeGoalRun(threadID)
                if (!next) {
                  toast.error('无法继续推进')
                  return
                }
                const prompt = buildContinuePrompt(next)
                rememberGoalPrompt(threadID, prompt)
                aui.composer.setText(prompt)
                void aui.composer.send()
                toast.success('已继续目标推进')
              }}>
              <Icon
                icon="lucide:play"
                className="size-3 shrink-0"
              />
              继续
            </Button>
          ) : null}
        </div>
      )
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="目标推进轮次"
              title={`目标推进：这次发送最多自动跑 ${budget} 轮`}
              className="text-violet-700 hover:text-violet-800 dark:text-violet-300 h-7 shrink-0 gap-1 rounded-md px-2 text-xs"
            />
          }>
          <Icon
            icon="lucide:target"
            className="size-3 shrink-0"
          />
          <span className="tabular-nums">{budget} 轮</span>
          <Icon
            icon="lucide:chevrons-up-down"
            className="size-3 shrink-0 opacity-60"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-60">
          {/* Label 是 base-ui GroupLabel：脱离 Group / RadioGroup 会抛 MenuGroupContext is missing (#31) */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>目标推进轮次</DropdownMenuLabel>
            <p className="text-muted-foreground px-2 pb-1 text-[11px] leading-snug">
              每次发送单独设置：这条任务最多自动推进几轮，跑满即停并给出收尾总结。
            </p>
            {GOAL_BUDGET_OPTIONS.map(function (option) {
              const active = option === budget
              return (
                <DropdownMenuItem
                  key={option}
                  className="gap-2"
                  onClick={function () {
                    writeNextGoalBudget(option)
                  }}>
                  <Icon
                    icon={active ? 'lucide:check' : 'lucide:circle'}
                    className={cn(
                      'size-3.5 shrink-0',
                      active ? 'text-primary' : 'text-muted-foreground/40'
                    )}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13px]">
                      {option} 轮{option === 6 ? '（默认）' : ''}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {option === 3
                        ? '小改动 / 单点验证'
                        : option === 6
                          ? '常规任务'
                          : '大改造 / 长链路'}
                    </span>
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const label =
    run.status === 'exhausted'
      ? `已用尽 · ${run.used}/${run.budget} 轮`
      : `第 ${Math.min(run.used + 1, run.budget)}/${run.budget} 轮`
  const progress = run.progress ? `达成 ${run.progress.done}/${run.progress.total}` : null

  return (
    <div className="border-violet-500/25 bg-violet-500/8 flex h-7 shrink-0 items-center gap-1 rounded-md border px-1.5">
      <Icon
        icon="lucide:target"
        className="size-3 shrink-0 text-violet-600 dark:text-violet-300"
      />
      <span className="text-violet-700 dark:text-violet-200 text-xs font-medium tabular-nums">
        {label}
      </span>
      {progress ? (
        <span className="text-muted-foreground text-[11px] tabular-nums">{progress}</span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="停止目标推进"
        title="停止目标自动推进（当前这一轮不受影响）"
        className="text-muted-foreground hover:text-foreground size-5"
        onClick={function () {
          stopGoalRun(run.threadID)
        }}>
        <Icon
          icon="lucide:square"
          className="size-2.5 fill-current"
        />
      </Button>
    </div>
  )
}

function ComposerFooter() {
  const { rootPath } = useActiveWorkspace()
  const snapshot = useWorkspaceGitSnapshot(rootPath)
  const showGit = snapshot.isRepo && Boolean(snapshot.branch)

  return (
    <div className="text-muted-foreground flex min-h-7 w-full items-center gap-2 px-1 text-xs">
      {/*
       * 左：工作区 / 文件夹 + 目标推进轮次（仅目标模式，是「这次发送」的输入）。
       * 左栏 `flex-1 min-w-0` 先让位给右侧；右侧不再设 `max-w-[62%]`：
       * 那个上限 + `shrink-0` 会把最后一个「上下文」挤出可视区，
       * 用户看到的就是「composer 里的上下文不见了」。
       */}
      <div className="flex min-w-0 flex-1 items-center justify-start gap-0.5 overflow-hidden">
        <WorkspaceMenu />
        <GoalTurnControl />
      </div>

      {/* 右：分支 │ 上下文用量（Git 信息与上下文分开，不糊成一排图标） */}
      <div className="flex shrink-0 items-center justify-end gap-0.5">
        {showGit ? (
          <BranchSwitcherView
            branch={snapshot.branch}
            locals={snapshot.branches?.branches ?? []}
            remotes={snapshot.branches?.remotes ?? []}
            ahead={snapshot.ahead}
            behind={snapshot.behind}
            isBusy={snapshot.isPending}
            size="sm"
            tone="header"
            menuAlign="end"
            className="max-w-32"
            onCheckout={function (name, fromRemote) {
              void checkoutNow(rootPath, name, fromRemote)
            }}
          />
        ) : null}
        {showGit ? (
          <span
            aria-hidden
            className="bg-border mx-0.5 h-3.5 w-px shrink-0"
          />
        ) : null}
        <UsageDisplay />
      </div>
    </div>
  )
}

export { ComposerFooter }
