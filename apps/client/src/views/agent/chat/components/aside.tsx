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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from 'react'
import { toast } from 'sonner'

import { subscribeAsideBrowser } from '@/views/agent/chat/components/open-aside-browser'
import { subscribeAsideTerminal } from '@/views/agent/chat/components/open-aside-terminal'
import { subscribeAsideTasks } from '@/views/agent/chat/components/open-aside-tasks'
import { subscribeAsideReview } from '@/views/agent/chat/components/open-aside-review'
import { useBrowserStore } from '@/features/browser/store'
import { normalizeToolPath } from '@/features/agent/tool-paths'
import { COMMAND } from '@/keyboard/definitions/ids'
import { useShortcut } from '@/keyboard/react'
import {
  findOwningRoot,
  findWorkspaceRelative,
  isAbsolutePath
} from '@/features/agent/workspace/paths'

import { AsideBusy } from './aside-busy'
import { findAsideFocusRoot, focusAsideFind, isAsideEditorFocus } from './aside-find'
import { openAsideEditorFind } from './aside-editor-find'
import { subscribeAsideContext } from './open-aside-context'
import { AsideBrowser } from './aside-browser'
import { AsideEmpty } from './aside-empty'
import { AsideFiles } from './aside-files'
import { AsideHistory } from './aside-history'
import { AsidePlan } from './aside-plan'
import { AsideReview } from './aside-review'
import { AsideTasks } from './aside-tasks'
import { AsideSkills } from './aside-skills'
import { AsideKnowledge } from './aside-knowledge'
import { AsideExtensions } from './aside-extensions'
import { TerminalSurface } from '@/features/terminal'
import {
  bootstrapTerminalSessions,
  ensureTerminalTab
} from '@/features/terminal/agent-tabs'
import { Terminal } from '@/lib/terminal'
import { DEFAULT_BUDGET, startGoalRun, stopGoalRun } from '@/features/agent/goal-run'
import { findPlanDraft } from '@/features/agent/plan-draft'
import { isPlanStale, readPlan, setPlanStatus } from '@/features/agent/plan-store'
import { buildPlanExecutePrompt } from '@/features/agent/plan-execute'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { readAgentMode, subscribeAgentMode, writeAgentMode } from '@/features/agent/mode'
import { isEmbeddedShell } from '@/features/window/shell-mode'
import { useTerminalStore, type TerminalTab } from '@/stores/terminal'

type AsideMode =
  | 'home'
  | 'plan'
  | 'tasks'
  | 'files'
  | 'knowledge'
  | 'skills'
  | 'review'
  | 'history'
  | 'browser'
  | 'extensions'
  | 'terminal'

interface AsideProps {
  className?: string
}

/** 嵌套壳里没有 IPC：藏掉依赖桌面能力的页签，避免递归开 browser */
const EMBEDDED_HIDDEN_TABS: ReadonlySet<AsideMode> = new Set(['browser', 'terminal', 'tasks'])

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
  { id: 'home', icon: 'lucide:layout-dashboard', label: '详情', hint: '会话与工作区概览' },
  { id: 'plan', icon: 'lucide:list-checks', label: '计划', hint: '本轮完整计划与确认执行' },
  { id: 'tasks', icon: 'lucide:calendar-clock', label: '任务', hint: '任务定义：创建、启停、立即执行与记录；执行会话按工作区落在侧栏' },
  { id: 'files', icon: 'lucide:folder-tree', label: '文件', hint: '浏览工作区文件树并预览' },
  { id: 'knowledge', icon: 'lucide:library', label: '知识库', hint: '浏览知识库文档并引用到对话' },
  { id: 'skills', icon: 'lucide:wrench', label: '技能', hint: '按工作区所有文件夹识别的技能' },
  { id: 'review', icon: 'lucide:git-compare', label: '审阅', hint: '本地/远端改动、暂存与提交' },
  { id: 'history', icon: 'lucide:history', label: '历史', hint: '查看提交历史与每次改动' },
  { id: 'browser', icon: 'lucide:globe', label: '浏览器', hint: '内嵌浏览器，agent 可读取并操作' },
  { id: 'extensions', icon: 'lucide:puzzle', label: '扩展', hint: 'MCP 与内置扩展开关' },
  { id: 'terminal', icon: 'lucide:terminal', label: '终端', hint: '在当前工作区打开 shell' }
]

function AgentAside(props: AsideProps) {
  const aui = useAui()

  /**
   * Ctrl/Cmd+F：焦点在右栏里时，这一键属于右栏自己的搜索框（文件树搜索），
   * 不能冒到 chat 那边去开「搜索整个会话」—— 那是另一个心智模型。
   *
   * 用 `useShortcut` 在处理器链前接管（优先级高于命令自身的 `run`）：
   * 焦点不在右栏时返回 `false`，会话搜索照旧；在右栏就收下 —— 先给搜索框，再给编辑器自带的查找框，
   * 两者都没有的页签（审阅 / 历史 / 计划…）只是吞掉这一键，宁可按了没反应也不跳去搜整个会话。
   */
  useShortcut(COMMAND.AGENT_FIND, function () {
    const scope = findAsideFocusRoot()
    if (!scope) return false
    // 文件树在（搜索框可见）：这一键给它
    if (focusAsideFind(scope)) return true
    // 打开预览时文件树是 hidden 的：这一键属于编辑器自己的查找框
    if (isAsideEditorFocus(scope) && openAsideEditorFind()) return true
    return true
  })

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
  /**
   * 存活终端会话数：刷新 / 重启后 zustand 是空的，必须先问 Rust（见下面的 bootstrap 副作用），
   * 否则用户既看不到后台还在跑的东西，也无从关闭。
   */
  const liveTerminalCount = useTerminalStore(function (state) {
    return state.tabs.filter(function (tab) {
      return !tab.exited
    }).length
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
  async function startImplement(target: 'agent' | 'goal', budget?: number) {
    // 新会话还没有落库 id：连「这一轮聊了什么」都没有，不能执行
    if (!threadID) {
      toast.error('先完成一轮对话再执行计划')
      return
    }
    // 点击时再读：不把整份 messages 常驻在本组件订阅链上
    const draft = findPlanDraft(aui.thread.getState().messages)
    // 有档案就以档案为准（计划可能来自文件、也可能已经被改过），否则退回当轮草稿
    const record = readPlan(threadID)
    const body = record?.body ?? draft?.body ?? ''
    const overview = record?.overview ?? draft?.overview ?? ''
    const steps = record?.steps ?? draft?.steps ?? []
    if (!body.trim() && steps.length === 0) {
      toast.error('还没有可执行的计划：先在计划模式产出一份，或从文件载入')
      return
    }
    // 已归档且没有更新版本可执行：拒绝跑旧版（只读态，保存 / 复制 / 载入仍可用）
    if (record && record.status === 'superseded' && !isPlanStale(record)) {
      toast.error('这份计划已归档：先按新计划执行，或把正文另存为一份新计划')
      return
    }
    // stale 时照跑，但跑的是 record 里**当前**这一版：把版本差说清楚，便于事后核对
    if (record && isPlanStale(record)) {
      const previous =
        record.executedRevision === null ? '旧版' : `r${record.executedRevision}`
      toast.info(`计划已更新到 r${record.revision}（上次执行基于 ${previous}），本次按新版执行`)
    }

    const prompt = buildPlanExecutePrompt({
      body,
      target,
      budget,
      overview,
      filePath: record?.filePath ?? null,
      revision: record?.revision
    })

    // 先落模式再开跑：以前 `void writeAgentMode()` 与 send 并发，模式还没落盘就跑起来了
    await writeAgentMode(target)
    setPlanStatus(threadID, 'running')

    if (target === 'goal') {
      const rounds = budget ?? DEFAULT_BUDGET
      const switched = startGoalRun(
        threadID,
        { summary: overview || steps.join('；') || '按计划推进', detail: body || overview },
        rounds,
        prompt
      )
      // 无人值守的前提：审批不能挡路。全部目标结束后会自动恢复原档位
      if (switched) {
        toast.info('已把审批切到「自动审批」—— 目标推进中途不停；全部结束后恢复原档位')
      }
    } else {
      // `null` / 空串在 stopGoalRun 里是 no-op（以前这里直接 TypeError）
      stopGoalRun(threadID)
    }

    // 发**计划正文全文**（清单只是摘要，见 plan-execute.ts 的说明）
    aui.composer.setText(prompt)
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
    if (!rootPath && useTerminalStore.getState().tabs.length === 0) {
      toast.error('先在左栏添加一个工作区')
      return
    }
    updateMode('terminal')
    // 先把后台存活会话灌回来，真的没有才新开 —— 否则每次进来都多一个空 shell
    void ensureTerminalTab(rootPath)
  }

  /**
   * 跳到终端页签（入口：详情页「正在执行」列表）。
   *
   * 必须 `openPanel()`：`reveal:false` 会导致 `TerminalSurface` 未挂载 → 空白页。
   * 优先按 command 命中 agent tab；否则按 workdir / `agent:` 会话回退。
   */
  async function openTerminal(
    command: string,
    workdir?: string | null,
    source: 'panel' | 'external' = 'panel'
  ) {
    function normalizePath(path: string): string {
      return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }

    async function findTab(): Promise<TerminalTab | undefined> {
      const store = useTerminalStore.getState()
      // 黑盒 shell：没有对应嵌入式 tab，只打开工作区终端
      if (source === 'external') return undefined
      if (command) {
        const byCommand = store.tabs.find(function (tab) {
          return tab.command === command
        })
        if (byCommand) return byCommand
      }
      if (!workdir) return undefined
      let agentId: string | null = null
      try {
        agentId = await Terminal.resolveAgentId(workdir)
      } catch (error) {
        console.warn('[agent/aside] resolveAgentId 失败:', error)
      }
      if (agentId) {
        const byId = store.tabs.find(function (tab) {
          return tab.id === agentId
        })
        if (byId) return byId
      }
      const needle = normalizePath(workdir)
      return store.tabs.find(function (tab) {
        return tab.origin === 'agent' && normalizePath(tab.cwd) === needle
      })
    }

    useTerminalStore.getState().openPanel()
    updateMode('terminal')

    // 刷新后 tabs 可能空：先灌回再匹配，避免空白面板
    await bootstrapTerminalSessions()
    const target = await findTab()
    if (target) {
      useTerminalStore.getState().writeActive(target.id)
      return
    }
    if (!rootPath) {
      toast.info(
        source === 'external'
          ? '这条命令不在嵌入式终端里；先添加工作区才能打开终端'
          : '这条命令的终端会话已经结束；先添加工作区才能新开终端'
      )
      return
    }
    await ensureTerminalTab(rootPath)
    const store = useTerminalStore.getState()
    if (!store.activeId && store.tabs.length > 0) {
      store.writeActive(store.tabs[0].id)
    }
  }

  // WebView 刷新后 tabs 空、Rust PTY 可能仍在：灌回 list 以便管理/关闭
  useEffect(function () {
    void bootstrapTerminalSessions()
  }, [])

  // 终端在别处被打开（快捷卡 / 命令面板 / agent-run）时同步切页签。
  // 用 layout effect：避免先挂 TerminalSurface 却仍 mode=home → overlay invisible 一帧，
  // xterm 在 0 尺寸上 fit 失败留下白屏。
  useLayoutEffect(
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
      return subscribeAsideTasks(function () {
        updateMode('tasks')
      })
    },
    []
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

  useEffect(
    function () {
      // 对话流里的命令卡：跳过来看**同一条命令**的输出（能命中就切到那个 agent 会话）
      return subscribeAsideTerminal(function (detail) {
        void openTerminal(detail.command ?? '', detail.workdir ?? null)
      })
    },
    // `openTerminal` 每次渲染都是新函数，按命令/目录订阅会反复解绑；它内部只读 store，
    // 用首次引用即可（与 `subscribeAsideBrowser` 同一处理）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(
    function () {
      return subscribeAsideContext(function () {
        updateMode('home')
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
    <div
      data-agent-aside=""
      className={clsx('bg-background flex h-full min-h-0', props.className)}>
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
              {tab.id === 'terminal' && liveTerminalCount > 0 ? (
                <span
                  aria-hidden
                  className="bg-primary text-primary-foreground absolute -top-0.5 -end-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-none font-semibold tabular-nums">
                  {liveTerminalCount > 9 ? '9+' : liveTerminalCount}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      {/***** 内容区：面板自己的顶部条（如终端多 tab）就是子 tab，没有就不渲染 *****/}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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

        {mode === 'knowledge' ? <AsideKnowledge aui={aui} /> : null}

        {mode === 'skills' ? <AsideSkills aui={aui} /> : null}

        {mode === 'extensions' ? <AsideExtensions /> : null}

        {mode === 'browser' ? <AsideBrowser /> : null}

        {mode === 'tasks' ? <AsideTasks /> : null}

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
              onOpenTerminal={function (command, workdir, source) {
                void openTerminal(command, workdir, source)
              }}
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
        {/*
         * 终端用**绝对定位覆盖层**，不用 `hidden` / `invisible`：
         * - display:none → 量到 0×0
         * - visibility:hidden → FitAddon 仍常 fit 出 0 列，切回 terminal 时尺寸不变不 refit → 白屏
         * opacity-0 保留可布局尺寸，HOME 下也能 fit；切到 terminal 只去透明。
         */}
        {terminalOpen ? (
          <div
            className={clsx(
              'bg-background absolute inset-0 flex min-h-0 flex-col',
              mode !== 'terminal' && 'pointer-events-none opacity-0'
            )}
            aria-hidden={mode !== 'terminal'}>
            <TerminalSurface
              cwd={rootPath}
              emptyCwdMessage="先在左栏添加一个工作区"
              paneVisible={mode === 'terminal'}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { AgentAside }
