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
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import { takeNextThreadWorkspace } from '@/features/agent/port/draft-workspace'
import { setAgentModeThread } from '@/features/agent/mode'
import { useRunningThreads } from '@/features/agent/acp/run-state'
import { chatModelPort, findHostOptions, historyPort } from '@/features/agent/port/instance'
import { buildThreadHistoryAdapter } from '@/features/agent/port/thread-history'
import { AgentElicitationDataUI } from '@/views/agent/chat/components/elicitation-data-ui'
import { AgentPlanDataUI } from '@/views/agent/chat/components/plan-data-ui'
import { parseWebSources } from '@/views/agent/chat/components/parse-tool-result'
import { createLocalSuggestionAdapter } from '@/views/agent/chat/suggestions'

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
  const mainThreadId = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  const runningIDs = useRunningThreads()
  const restored = useRef(false)

  useEffect(
    function () {
      if (restored.current) return
      if (mainThreadId) {
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
    [threadItems, mainThreadId, runningIDs, aui]
  )

  return null
}

/**
 * 模式是**会话级**的：把当前 `mainThreadId` 同步给 `mode.ts`，
 * 让 composer、详情页与系统提示读到的都是本会话的模式（新会话回落全局默认）。
 */
function AgentModeThreadSync() {
  const threadID = useAuiState(function (state) {
    return state.threads.mainThreadId
  })
  useEffect(
    function () {
      setAgentModeThread(threadID ?? null)
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
      <AgentModeThreadSync />
      {props.children}
    </AssistantRuntimeProvider>
  )
}

export { AgentRuntimeProvider }
