/**
 * Chat runtime：**一条通路**。
 *
 * 会话列表自建（`useRemoteThreadListRuntime`），生成统一走 `useLocalRuntime` + `ChatModelPort`
 * —— 不管跑的是本机 provider 还是平台网关，请求都由 goose 侧发出，所以工具、审批、计划、
 * 用量、历史全套能力两边一致；差别只在 goose 按会话配置项解析凭据（见 `port/model.ts`）。
 */
import {
  AssistantRuntimeProvider,
  useAui,
  useAuiState,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  type AssistantClient,
  type AssistantRuntime,
  type ThreadHistoryAdapter
} from '@assistant-ui/react'
import { createChatModelAdapter } from '@cogito/chat/adapters/chat-model'
import type { ThreadIdentity } from '@cogito/chat/adapters/thread-history'
import { createThreadListAdapter } from '@cogito/chat/adapters/thread-list'
import { installCitationExtractor } from '@cogito/design/assistant/message-citations'
import { installUserMessageBadgeResolver } from '@cogito/design/assistant/user-message-badge'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import { useRunningThreads } from '@/features/agent/acp/run-state'
import { subscribeAutomationLife } from '@/features/automation/events'
import { takeNextThreadWorkspace } from '@/features/agent/port/draft-workspace'
import { findAgentMode, readModeSnapshot, setAgentModeThread } from '@/features/agent/mode'
import { chatModelPort, findHostOptions, historyPort } from '@/features/agent/port/instance'
import { hydrate } from '@/features/agent/plan-store'
import { buildThreadHistoryAdapter } from '@/features/agent/port/thread-history'
import { AgentElicitationDataUI } from '@/views/agent/chat/components/elicitation-data-ui'
import { AgentPlanDataUI } from '@/views/agent/chat/components/plan-data-ui'
import { findSessionKey, useResolvedSessionID } from '@/views/agent/chat/components/use-session-thread-id'
import { parseWebSources } from '@/views/agent/chat/components/parse-tool-result'
import { createLocalSuggestionAdapter } from '@/views/agent/chat/suggestions'
import { useAgentStore } from '@/stores/agent'

/**
 * 内联引用角标的数据源：从本条消息的工具结果里聚合 web 来源，按出现顺序去重。
 * 正文里的 `[1]` / `[2]` 就按这个序号映射到具体链接。
 */
installCitationExtractor(function (parts) {
  const sources: Array<{ title: string; href: string }> = []
  for (const part of parts) {
    const candidate = part as {
      type?: string
      toolName?: string
      args?: unknown
      result?: unknown
    }
    if (candidate.type !== 'tool-call' || !candidate.toolName) continue
    const found = parseWebSources(candidate.toolName, candidate.args, candidate.result, '')
    for (const source of found) {
      if (
        sources.some(function (item) {
          return item.href === source.href
        })
      ) {
        continue
      }
      sources.push({ title: source.title || source.href, href: source.href })
    }
  }
  return sources
})

/**
 * 用户消息上的模式徽标：只认消息里的快照（没有快照的老消息不显示）。
 * 模式语义留在 app 侧，design 只提供插槽与样式。
 */
installUserMessageBadgeResolver(function (message) {
  const snapshot = readModeSnapshot(message.metadata)
  if (!snapshot) return null
  const meta = findAgentMode(snapshot.mode)
  return {
    icon: meta.icon,
    label: meta.label,
    hint: `本条消息以「${meta.label}」模式发送`,
    accent: snapshot.mode !== 'agent'
  }
})

/**
 * 把会话的**归属**发回列表项。
 *
 * 左栏按条目的 `custom.workspaceID` 归拢会话，而库 `initialize()` 只回 `remoteId`，
 * 不会把 `createThread` 写进库的那一行带回来 —— 不补这一次，新建会话会一直落在「未分组」，
 * 直到整张列表重载（重启）。归属读**落库的那一行**：草稿里记的是点击时的意图，
 * 真实归属以库为准，两者不一致时听库的。
 *
 * 失败不抛：列表项的归属只是侧栏分组的乐观视图，库里那行仍然是对的。
 */
async function publishThreadWorkspace(aui: AssistantClient, threadID: string): Promise<void> {
  const item = aui.threadListItem.getState()
  // 老会话的归属随 `list()` 一起来，不必再问一次库
  if (item.custom && 'workspaceID' in item.custom) return
  try {
    const thread = await historyPort.findThread(threadID)
    if (!thread) return
    void aui.threadListItem.updateCustom({ ...item.custom, workspaceID: thread.workspaceID })
  } catch (error) {
    console.warn('[agent/runtime] 会话归属未能发回列表项:', error)
  }
}

/**
 * 本线程的库内会话 id。
 *
 * 会话 id 是**落库后**才存在的，而列表项状态在 promotion / reconcile 期间可能还停在空值上。
 * 直接拿空值去用，代价是静默的：写历史 → 撞外键 + assistant-ui 吞掉 rejection（消息发出去了、
 * 库里没有）；取 host → 空值被结构化克隆丢掉 → 运行按「没有会话」失败。
 *
 * 所以身份只认两件事：库里的权威 id，或者明确的失败。
 * - `resolve()`：读路径（load），不建会话，拿不到就返回 null
 * - `ensure()`：写路径（历史写入、运行取 host），拿不到 id 就抛错
 *
 * 与 studio 的差别：客户端在 `createThread` 落库时就把归属写定了（草稿里记着点击的工作区），
 * 但**列表项**的 `custom` 仍需在这里补一次 —— 库不会把落库时写的归属带回来。
 */
function useThreadIdentity(): ThreadIdentity {
  const aui = useAui()
  /** 落库之后才有的权威 id —— 归属的发布挂在这个跳变上 */
  const remoteId = useAuiState(function (state) {
    return state.threadListItem.remoteId
  })

  /** 「这一线程的那次建会话」放在 ref 里：它在渲染之外被读写，且要跨重渲染活着 */
  const created = useRef<{ localID: string; task: Promise<string> } | null>(null)

  const identity = useMemo(
    function () {
      function itemState() {
        return aui.threadListItem.getState()
      }

      async function resolve(): Promise<string | null> {
        const known = itemState().remoteId ?? null
        if (known) return known
        // 全新会话（`status === 'new'`）还没落库，读路径不该把它建出来
        if (itemState().status === 'new') return null
        // 其余状态：`initialize()` 只是 await 列表项已有的初始化任务（幂等）
        return (await aui.threadListItem.initialize()).remoteId ?? itemState().remoteId ?? null
      }

      /**
       * 结果**按线程记住**（键用列表项 id）：同一线程的首次写入有多个并发调用方
       * （历史 append、运行取 host），而「建会话」不是互斥的 —— 并起来会建出两条会话行，
       * 于是「消息在 1 号会话里，账却记在 2 号会话上」。
       */
      function ensure(): Promise<string> {
        const localID = itemState().id
        const cached = created.current
        if (cached && cached.localID === localID) return cached.task

        const task = makeSessionID()
        created.current = { localID, task }
        return task
      }

      async function makeSessionID(): Promise<string> {
        const resolved = await resolve()
        if (resolved) return resolved

        const opened = await aui.threadListItem.initialize()
        const createdID = opened?.remoteId ?? itemState().remoteId ?? null
        if (!createdID) throw new Error('[agent] 会话初始化后仍没有 id，本次写入被拒绝')
        return createdID
      }

      return { resolve, ensure }
    },
    [aui, created]
  )

  // 不 await：`updateCustom` 同步改列表项状态（乐观），落库在后台 —— 侧栏分组不必等它
  useEffect(
    function () {
      if (!remoteId) return
      void publishThreadWorkspace(aui, remoteId)
    },
    [aui, remoteId]
  )

  return identity
}

function useThreadHistory(identity: ThreadIdentity): ThreadHistoryAdapter {
  return useMemo(
    function () {
      // 带 `unstable_resume`：离开 Agent 后 ACP 仍在跑，回来主动续上缓冲 + 实时尾部
      return buildThreadHistoryAdapter(historyPort, identity)
    },
    [identity]
  )
}

function useThreadRuntime(): AssistantRuntime {
  const identity = useThreadIdentity()
  const suggestion = useMemo(function () {
    return createLocalSuggestionAdapter()
  }, [])

  return useLocalRuntime(
    createChatModelAdapter(chatModelPort, {
      // 运行也要权威会话 id：控制器按它定位会话与票据，读空值会另起一个 goose 会话
      findHost: async function (target) {
        return findHostOptions(target, await identity.ensure())
      }
    }),
    {
      // 运行中发送进 composer.queue，当前轮次结束后再 FIFO 开新 turn（每线程独立 runtime）
      unstable_enableMessageQueue: true,
      // 停止只中断当前这一轮：队列里的消息稍后照发（产品口径，2026-11）
      unstable_queueClearOnCancel: false,
      adapters: {
        history: useThreadHistory(identity),
        suggestion
      }
    }
  )
}

/**
 * 刷新后自动回到「正在运行」的会话。
 *
 * 列表加载完、且还没有选中任何会话（欢迎页）时，从运行态挑一个正在跑的会话
 * （运行态存的是落库会话 id = 列表项的 `remoteId`），`switchToThread` 会让该线程的
 * `history.load` 检测到 orphanRunning → `unstable_resume` → 继续渲染（见 port/thread-history）。
 *
 * 只在一次会话生命周期里恢复一次：用户之后手动切走，不再抢回焦点。
 */
interface RunningThreadItem {
  id?: string
  remoteId?: string
}

function RestoreRunningThread() {
  const aui = useAui()
  const threadItems = useAuiState(function (state) {
    return state.threads.threadItems
  })
  const runningIDs = useRunningThreads()
  const restored = useRef(false)
  /**
   * 挂载时 assistant-ui 会先播一个**草稿**主线程 —— `mainThreadId` 从第一帧起就非空，
   * 所以「用户是否已选中会话」不能看它是否为空，要看当前主线程是否**已经落库**。
   * 旧实现判空 → 首帧必命中早退 → 刷新后永远回不到在跑的会话。
   */
  const isDraftThread = useAuiState(function (state) {
    const id = state.threads.mainThreadId
    if (!id) return true
    const item = state.threads.threadItems.find(function (entry) {
      return entry.id === id
    })
    return !item?.remoteId
  })

  useEffect(
    function () {
      if (restored.current) return
      if (!isDraftThread) {
        // 已经选中了会话（例如用户点过）：不抢焦点
        restored.current = true
        return
      }
      if (!Array.isArray(threadItems) || threadItems.length === 0) return

      restored.current = true
      const items = threadItems as RunningThreadItem[]
      const runningItem = items.find(function (item) {
        return Boolean(item.remoteId && runningIDs.has(item.remoteId))
      })
      if (runningItem?.id) {
        aui.threads.switchToThread(runningItem.id)
      }
    },
    [threadItems, isDraftThread, runningIDs, aui]
  )

  return null
}

/**
 * 自动化开泵后切到对应会话：先 `threads.reload` 再 switch，
 * 让 history.load 看到 `hasRunningBackgroundTurn` → `unstable_resume` 接上流式。
 *
 * 已在该会话时必须走 `reloadMainThread()`：`threads.reload()` 只刷列表，
 * `switchToThread(同一条)` 在 `isSameThread` 处直接返回空 Promise —— 目标多轮时会
 * 「泵在跑、界面一动不动」。
 */
function FocusAutomationSession() {
  const aui = useAui()
  useEffect(
    function () {
      async function focus(sessionId: string) {
        // 当前会话的库内 id：与自动化事件里的 `sessionId` 同一把键
        const current = findSessionKey(aui.threads.getState())
        if (current && current === sessionId) {
          await aui.threads.reloadMainThread()
          return
        }
        await aui.threads.reload()
        // `switchToThread` 在客户端作用域里是同步派发（返回 void），不用 await
        aui.threads.switchToThread(sessionId)
      }
      return subscribeAutomationLife(function (event) {
        if (event.kind !== 'stream') return
        void focus(event.sessionId).catch(function (error: unknown) {
          console.warn('[agent/runtime] 切到自动化会话失败:', error)
        })
      })
    },
    [aui]
  )
  return null
}

/**
 * 模式是**会话级**的：把当前会话的**库内 id** 同步给 `mode.ts`，
 * 让 composer、详情页与系统提示读到的都是本会话的模式（新会话回落全局默认）。
 *
 * 必须用 `remoteId`：`mainThreadId` 是列表项 id（草稿期是 `__LOCALID_…`），而 ACP / 审批
 * 执行侧一律按库内 id 读 —— 用草稿 id 写等于「写进了一个永远没人读的键」。
 */
function AgentModeThreadSync() {
  const threadID = useResolvedSessionID()
  useEffect(
    function () {
      setAgentModeThread(threadID ?? null)
      /*
       * 同一个 id 也要写给 `agent` store：设置页（工具权限 / 扩展 / 诊断 / 用量）是 chat 的
       * **兄弟路由**，不在 `AssistantRuntimeProvider` 里，拿不到 `useAuiState`。
       * 以前那个指针只在启动取首项、命令面板打开会话时更新，侧栏切会话后设置页一直
       * 指着别的会话（权限写到错的 ACP 会话、工具面/诊断看的是旧会话）。
       */
      useAgentStore.getState().toSyncActiveSession(threadID ?? null)
    },
    [threadID]
  )
  return null
}

/**
 * 档案 hydrate：cache 没灌入时 `readPlan` 返回 null，右栏会闪一下空态。
 * 启动读全量（一行一个会话，量级 < 千行）；切会话再补读该会话。
 */
function PlanStoreSync() {
  const threadID = useResolvedSessionID()

  useEffect(function () {
    void hydrate()
  }, [])

  useEffect(
    function () {
      if (threadID) void hydrate([threadID])
    },
    [threadID]
  )

  return null
}

function AgentRuntimeProvider(props: { children: ReactNode }) {
  const list = useMemo(function () {
    // 新建会话的归属取「用户点下的那个 +」；草稿只在落库那一刻用得上
    return createThreadListAdapter(historyPort, {
      resolveWorkspaceID: function () {
        return takeNextThreadWorkspace()?.workspaceID
      }
    })
  }, [])

  const runtime = useRemoteThreadListRuntime({ adapter: list, runtimeHook: useThreadRuntime })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentPlanDataUI />
      <AgentElicitationDataUI />
      <RestoreRunningThread />
      <FocusAutomationSession />
      <AgentModeThreadSync />
      <PlanStoreSync />
      {props.children}
    </AssistantRuntimeProvider>
  )
}

export { AgentRuntimeProvider }
