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
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import { subscribeAsideBrowser } from '@/views/agent/chat/components/open-aside-browser'
import { subscribeAsideReview } from '@/views/agent/chat/components/open-aside-review'
import { useBrowserStore } from '@/features/browser/store'
import { normalizeToolPath } from '@/features/agent/tool-paths'
import {
  findOwningRoot,
  findWorkspaceRelative,
  isAbsolutePath
} from '@/features/agent/workspace/paths'

import { AsideBusy } from './aside-busy'
import { AsideBrowser } from './aside-browser'
import { AsideEmpty } from './aside-empty'
import { AsideFiles } from './aside-files'
import { AsideHistory } from './aside-history'
import { AsidePlan } from './aside-plan'
import { AsideReview } from './aside-review'
import { TerminalSurface } from '@/features/terminal'
import { DEFAULT_BUDGET, startGoalRun, stopGoalRun } from '@/features/agent/goal-run'
import { findPlanDraft } from '@/features/agent/plan-draft'
import { buildPlanExecutePrompt } from '@/features/agent/plan-execute'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { readAgentMode, subscribeAgentMode, writeAgentMode } from '@/features/agent/mode'
import { isEmbeddedShell } from '@/features/window/shell-mode'
import { useTerminalStore } from '@/stores/terminal'

type AsideMode = 'home' | 'plan' | 'files' | 'review' | 'history' | 'browser' | 'terminal'

interface AsideProps {
  className?: string
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
  { id: 'review', icon: 'lucide:git-compare', label: '审阅', hint: '本地/远端改动、暂存与提交' },
  { id: 'history', icon: 'lucide:history', label: '历史', hint: '查看提交历史与每次改动' },
  { id: 'browser', icon: 'lucide:globe', label: '浏览器', hint: '内嵌浏览器，agent 可读取并操作' },
  { id: 'terminal', icon: 'lucide:terminal', label: '终端', hint: '在当前工作区打开 shell' }
]

function AgentAside(props: AsideProps) {
  const aui = useAui()
  /** 布尔标量：避免整份 messages 引用变化拖着重渲染 */
  const hasUserMessage = useAuiState(function (state) {
    return state.thread.messages.some(function (message) {
      return message.role === 'user'
    })
  })
  const isEmbedded = isEmbeddedShell()

  const terminalOpen = useTerminalStore(function (state) {
    return state.open
  })
  const { rootPath, folderPaths, selectRoot } = useActiveWorkspace()

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
  /**
   * 「从产出点进某个文件」的定向焦点。焦点**带根**：它只在当时的文件夹里成立，
   * 用户在别处切了文件夹就自动失效 —— 不用 effect 去清，也就不会和
   * 「先 selectRoot 再设焦点」的批量更新抢顺序。
   */
  const [focus, updateFocus] = useState<{
    root: string | null
    relative: string | null
  } | null>(null)
  const focusRelative = focus && focus.root === rootPath ? focus.relative : null
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const agentMode = useSyncExternalStore(subscribeAgentMode, readAgentMode, readAgentMode)
  /**
   * 换会话或换文件夹都重挂面板：展开态 / diff / 浏览位置只对一个目录成立。
   * 文件夹是全局「当前文件夹」，审阅、历史、文件、composer 看到的是同一个根。
   */
  const panelKey = `${threadID ?? 'none'}:${rootPath ?? ''}`

  /**
   * 计划确认执行：先切到对应模式再发消息。
   *
   * - `agent`：普通执行，按阶段顺序推进；
   * - `goal`：目标推进——记下预算后由 `GoalAutoAdvance` 在每轮结束时自动续跑。
   *
   * 发的是**计划正文全文**。早期版本只把 `findPlanDraft().steps` 拼成清单发出去，
   * 而清单是从正文抽出来的摘要（一条只剩一行），模型据此只做了象征性实现，
   * 文件级细节与验证步骤全被丢掉 —— 这是「计划执行不完整」的根因。
   */
  function startImplement(target: 'agent' | 'goal', budget?: number) {
    // 点击时再读：不把整份 messages 常驻在本组件订阅链上
    const draft = findPlanDraft(aui.thread.getState().messages)
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

    // 发**计划正文全文**（清单只是摘要，见 plan-execute.ts 的说明）
    aui.composer.setText(
      buildPlanExecutePrompt({
        body: draft?.body ?? '',
        target,
        budget,
        overview: draft?.overview
      })
    )
    void aui.composer.send()
  }

  /**
   * 工具卡给的是绝对路径，可能落在工作区里任意一个文件夹：
   * 先找出归属文件夹，必要时把「当前文件夹」切过去，再给面板一个**该根内**的相对路径。
   * 以前只认当前根，别的项目里的产出会被判成「不在工作区内」。
   */
  const locateTarget = useCallback(
    function (rawPath?: string | null) {
      if (!rawPath) return { root: rootPath, relative: null }
      const normalized = rawPath.replace(/\\/g, '/')
      const isAbsolute = isAbsolutePath(normalized)
      if (!isAbsolute) return { root: rootPath, relative: normalizeToolPath(normalized, rootPath) }
      const owner = findOwningRoot(normalized, folderPaths)
      if (!owner) return { root: rootPath, relative: null }
      const relative = findWorkspaceRelative(normalized, owner)
      return { root: owner, relative: relative === '.' ? null : relative }
    },
    [rootPath, folderPaths]
  )

  function openFiles(rawPath?: string | null) {
    const target = locateTarget(rawPath)
    if (rawPath && !target.relative) {
      toast.error('这个文件不在工作区里')
      return
    }
    if (target.root && target.root !== rootPath) selectRoot(target.root)
    updateFocus({ root: target.root ?? rootPath, relative: target.relative })
    updateMode('files')
  }

  /** 工具卡常给绝对路径；审阅 IPC 只认某一根内的相对路径 */
  const openReview = useCallback(
    function (rawPath?: string | null) {
      const target = locateTarget(rawPath)
      if (rawPath && !target.relative) {
        toast.error('这个文件不在工作区里')
        return
      }
      if (target.root && target.root !== rootPath) selectRoot(target.root)
      updateFocus({ root: target.root ?? rootPath, relative: target.relative })
      updateMode('review')
    },
    [locateTarget, rootPath, selectRoot]
  )

  /**
   * 页签切换：终端不是「另一个面板」，而是这里的一个普通页签；没开就先开一个。
   * 点文件/审阅页签等于回到该页入口（清掉上次的定向焦点）。
   */
  function selectTab(next: AsideMode) {
    if (next !== 'terminal') {
      updateFocus(null)
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

  /**
   * 跳到终端页签（入口：详情页「正在执行」列表）。
   *
   * 命令若来自嵌入式终端（agent 用 `app_terminal_run` 执行），tab 上会记着同一条命令，
   * 直接选中那个 tab；否则是 goose 自带 shell 跑的命令，只能停在当前文件夹的终端。
   */
  function openTerminal(command: string) {
    if (!terminalOpen) {
      if (!rootPath) {
        toast.error('先在左栏添加一个工作区')
        return
      }
      useTerminalStore.getState().newTab(rootPath, { reveal: false })
    }
    const target = useTerminalStore.getState().tabs.find(function (tab) {
      return tab.command === command
    })
    if (target) useTerminalStore.getState().writeActive(target.id)
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
    [openReview]
  )

  useEffect(
    function () {
      return subscribeAsideBrowser(function (detail) {
        const label = detail.label?.trim()
        if (label) {
          void useBrowserStore
            .getState()
            .activateTab(label)
            .catch(function (error: unknown) {
              console.warn('[agent/aside] 激活浏览器 tab 失败:', error)
            })
        }
        updateMode('browser')
      })
    },
    []
  )

  // 切会话时清掉上一个会话的定向焦点，避免新会话直接落到别人的文件
  useEffect(
    function () {
      updateFocus(null)
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
            key={panelKey}
            aui={aui}
            initialRelative={focusRelative}
            onOpenReview={function (relative) {
              openReview(relative)
            }}
          />
        ) : null}

        {mode === 'review' ? (
          <AsideReview
            key={panelKey}
            initialRelative={focusRelative}
            onOpenFile={openFiles}
          />
        ) : null}

        {mode === 'history' ? <AsideHistory key={panelKey} /> : null}

        {mode === 'browser' ? <AsideBrowser /> : null}

        {mode === 'plan' ? (
          <AsidePlan
            key={panelKey}
            isPlanMode={agentMode === 'plan'}
            onStartImplement={startImplement}
          />
        ) : null}

        {mode === 'home' ? (
          hasUserMessage ? (
            <AsideBusy
              key={panelKey}
              onOpenFiles={openFiles}
              onOpenReview={openReview}
              onOpenPlan={function () {
                selectTab('plan')
              }}
              onOpenTerminal={openTerminal}
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
          <div className={clsx('flex min-h-0 flex-1 flex-col', mode !== 'terminal' && 'hidden')}>
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
