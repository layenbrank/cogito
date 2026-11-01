/**
 * 右栏容器：左侧**纵向图标导航** + 内容区。
 *
 * 页签不再横排在顶部 —— 右栏本身窄，横向会被文字吃掉一大截宽度；纵向只占 48px，
 * 完整说明走 `title`。内容区顶部留给**子 tab**（终端多 tab 就是这么放的），
 * 没有子 tab 的面板直接铺内容。终端仍常驻挂载、用 `hidden` 切换，切走再回来不重建 xterm。
 */
import { Icon } from '@iconify/react/offline'
import { useAui, useAuiState } from '@assistant-ui/react'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { subscribeAsideReview } from '@/views/agent/chat/components/open-aside-review'
import { normalizeToolPath } from '@/features/agent/tool-paths'

import { AsideBusy } from './aside-busy'
import { AsideBrowser } from './aside-browser'
import { AsideEmpty } from './aside-empty'
import { AsideFiles } from './aside-files'
import { AsideHistory } from './aside-history'
import { AsidePlan } from './aside-plan'
import { AsideReview } from './aside-review'
import { TerminalSurface } from '@/features/terminal'
import type { PlanSnapshot } from '@/features/agent/plan'
import { DEFAULT_BUDGET, startGoalRun, stopGoalRun } from '@/features/agent/goal-run'
import { findPlanDraft } from '@/features/agent/plan-draft'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { readAgentMode, subscribeAgentMode, writeAgentMode } from '@/features/agent/mode'
import { isEmbeddedShell } from '@/features/window/shell-mode'
import { useTerminalStore } from '@/stores/terminal'

type AsideMode = 'home' | 'plan' | 'files' | 'review' | 'history' | 'browser' | 'terminal'

interface AsideProps {
  className?: string
  plan: PlanSnapshot | null
}

/** 嵌套壳里没有 IPC：藏掉依赖桌面能力的页签，避免递归开 browser */
const EMBEDDED_HIDDEN_TABS: ReadonlySet<AsideMode> = new Set(['browser', 'terminal'])

/**
 * 页签定义即入口清单：图标 + 文案一起给出来，
 * 避免像以前那样只能靠两个无标题图标去猜它会打开什么。
 */
const ASIDE_TABS: ReadonlyArray<{
  id: AsideMode
  icon: string
  label: string
  hint: string
}> = [
  { id: 'home', icon: 'lucide:layout-dashboard', label: '详情', hint: '会话、工作区与任务清单' },
  { id: 'plan', icon: 'lucide:list-checks', label: '计划', hint: '本轮完整计划与确认执行' },
  { id: 'files', icon: 'lucide:folder-tree', label: '文件', hint: '浏览工作区文件树并预览' },
  { id: 'review', icon: 'lucide:git-compare', label: '审阅', hint: '整体改动与逐文件对比' },
  { id: 'history', icon: 'lucide:history', label: '历史', hint: '查看提交历史与每次改动' },
  { id: 'browser', icon: 'lucide:globe', label: '浏览器', hint: '内嵌浏览器，agent 可读取并操作' },
  { id: 'terminal', icon: 'lucide:terminal', label: '终端', hint: '在当前工作区打开 shell' }
]

function AgentAside(props: AsideProps) {
  const aui = useAui()
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const isEmbedded = isEmbeddedShell()

  const terminalOpen = useTerminalStore(function (state) {
    return state.open
  })
  const { rootPath } = useActiveWorkspace()

  const [mode, updateMode] = useState<AsideMode>('home')
  const visibleTabs = useMemo(
    function () {
      if (!isEmbedded) return ASIDE_TABS
      return ASIDE_TABS.filter(function (tab) {
        return !EMBEDDED_HIDDEN_TABS.has(tab.id)
      })
    },
    [isEmbedded]
  )
  /** 仅用于「从产出点进某个文件」时直接落到该文件；点页签会清空，回到列表根 */
  const [focusRelative, updateFocusRelative] = useState<string | null>(null)
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const agentMode = useSyncExternalStore(subscribeAgentMode, readAgentMode, readAgentMode)

  /**
   * 计划确认执行：**先切到对应模式**再发消息。
   *
   * - `agent`：普通执行，逐条推进即可；
   * - `goal`：目标推进 —— 记下预算后由 `GoalAutoAdvance` 在每轮结束时自动续跑，
   *   中途不打断用户（Qoder 的 Goal 驱动）。
   *
   * 指令里显式重复任务清单：计划全文虽在同一会话里，但逐条列出来能避免
   * 模型在长上下文里漏步 —— 清单是执行依据，计划正文只是说明书。
   */
  function startImplement(target: 'agent' | 'goal', budget?: number) {
    const draft = findPlanDraft(messages)
    const steps = draft?.steps ?? []

    if (target === 'goal') {
      if (!threadID) {
        toast.error('先完成一轮对话再启动目标推进')
        return
      }
      const rounds = budget ?? DEFAULT_BUDGET
      writeAgentMode('goal')
      const switched = startGoalRun(
        threadID,
        draft?.overview || steps.join('；') || '按计划推进',
        rounds
      )
      // 无人值守的前提：审批不能挡路。全部目标结束后会自动恢复原档位
      if (switched) {
        toast.info('已把审批切到「自动审批」—— 目标推进中途不停；全部结束后恢复原档位')
      }
    } else {
      writeAgentMode('agent')
      stopGoalRun(threadID)
    }

    const lines = ['按上面的计划开始执行。']
    if (target === 'goal') {
      lines.push(
        `以目标模式推进，最多 ${budget ?? DEFAULT_BUDGET} 轮，中途不要停下来问用户。`,
        '约束以我前面消息里说的为准（不要/保持/只能/不能 这类），开工前先复述一遍。'
      )
    }
    if (steps.length > 0) {
      lines.push('严格按下列任务清单逐条推进，每完成一条用一句话汇报结果：')
      steps.forEach(function (step, index) {
        lines.push(`${index + 1}. ${step}`)
      })
    }
    aui.composer.setText(lines.join('\n'))
    void aui.composer.send()
  }

  const hasUserMessage = useMemo(
    function () {
      return messages.some(function (message) {
        return message.role === 'user'
      })
    },
    [messages]
  )

  function openFiles(relative?: string | null) {
    updateFocusRelative(relative ?? null)
    updateMode('files')
  }

  /** 工具卡常给绝对路径；审阅 IPC 只认工作区相对路径 */
  function openReview(rawPath?: string | null) {
    const relative = rawPath ? normalizeToolPath(rawPath, rootPath) : null
    if (rawPath && !relative) {
      toast.error('该路径不在当前工作区内')
      return
    }
    updateFocusRelative(relative)
    updateMode('review')
  }

  /**
   * 页签切换：终端不是「另一个面板」，而是这里的一个普通页签；没开就先开一个。
   * 点文件/审阅页签等于回到该页入口（清掉上次的定向焦点）。
   */
  function selectTab(next: AsideMode) {
    if (next !== 'terminal') {
      updateFocusRelative(null)
      updateMode(next)
      return
    }
    if (!terminalOpen) {
      if (!rootPath) {
        toast.error('先在左栏添加一个工作区')
        return
      }
      useTerminalStore.getState().newTab(rootPath)
    }
    updateMode('terminal')
  }

  // 终端在别处被打开（快捷卡 / 命令面板）时自动翻到这页；被关掉时退回详情
  useEffect(
    function () {
      if (terminalOpen) {
        updateMode('terminal')
        return
      }
      updateMode(function (current) {
        return current === 'terminal' ? 'home' : current
      })
    },
    [terminalOpen]
  )

  useEffect(
    function () {
      return subscribeAsideReview(function (detail) {
        openReview(detail.relative)
      })
    },
    [rootPath]
  )

  // 切会话时清掉上一个会话的定向焦点，避免新会话直接落到别人的文件
  useEffect(
    function () {
      updateFocusRelative(null)
    },
    [threadID]
  )

  // 嵌套壳误进 browser/terminal 时退回详情
  useEffect(
    function () {
      if (!isEmbedded) return
      if (!EMBEDDED_HIDDEN_TABS.has(mode)) return
      updateMode('home')
    },
    [isEmbedded, mode]
  )

  return (
    <div className={clsx('bg-background flex h-full min-h-0', props.className)}>
      {/*
       * 纵向导航：固定 48px 图标列。右栏默认才 400px，图标+文字要 96px，
       * 内容会被挤掉四分之一 —— 所以只留图标，完整说明放 `title`。
       */}
      <nav
        role="tablist"
        aria-label="工作区"
        aria-orientation="vertical"
        className="border-border flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden border-e py-1.5">
        {visibleTabs.map(function (tab) {
          const active = mode === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={tab.label}
              title={`${tab.label} · ${tab.hint}`}
              onClick={function () {
                selectTab(tab.id)
              }}
              className={clsx(
                'relative flex size-9 items-center justify-center rounded-md transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}>
              <Icon
                icon={tab.icon}
                className="size-4 shrink-0"
              />
            </button>
          )
        })}
      </nav>

      {/***** 内容区：面板自己的顶部条（如终端多 tab）就是子 tab，没有就不渲染 *****/}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {mode === 'files' ? (
          <AsideFiles
            key={threadID ?? 'none'}
            aui={aui}
            initialRelative={focusRelative}
            onOpenReview={function (relative) {
              openReview(relative)
            }}
          />
        ) : null}

        {mode === 'review' ? (
          <AsideReview
            key={threadID ?? 'none'}
            initialRelative={focusRelative}
          />
        ) : null}

        {mode === 'history' ? <AsideHistory key={threadID ?? 'none'} /> : null}

        {mode === 'browser' ? <AsideBrowser /> : null}

        {mode === 'plan' ? (
          <AsidePlan
            key={threadID ?? 'none'}
            plan={props.plan}
            isPlanMode={agentMode === 'plan'}
            onStartImplement={startImplement}
          />
        ) : null}

        {mode === 'home' ? (
          hasUserMessage ? (
            <AsideBusy
              key={threadID ?? 'none'}
              plan={props.plan}
              onOpenFiles={openFiles}
              onOpenReview={openReview}
              isPlanMode={agentMode === 'plan'}
            />
          ) : (
            <AsideEmpty
              onOpenFiles={openFiles}
              onOpenReview={openReview}
            />
          )
        ) : null}

        {/*
         * 终端始终挂载、用 hidden 切换：切到别的页签再回来不会重建 xterm 丢失滚动缓冲。
         * 只有真正打开过（terminalOpen）才挂载，避免一进右栏就白开一个 shell。
         */}
        {terminalOpen ? (
          <div
            className={clsx(
              'flex min-h-0 flex-1 flex-col',
              mode !== 'terminal' && 'hidden'
            )}>
            <TerminalSurface
              cwd={rootPath}
              emptyCwdMessage="先在左栏添加一个工作区"
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { AgentAside }
