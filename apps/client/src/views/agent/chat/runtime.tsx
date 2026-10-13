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
  useLocalRuntime,
  useRemoteThreadListRuntime,
  type AssistantRuntime,
  type ThreadHistoryAdapter
} from '@assistant-ui/react'
import { createChatModelAdapter } from '@i-thinking/chat/adapters/chat-model'
import { createThreadHistoryAdapter, type ThreadIdentity } from '@i-thinking/chat/adapters/thread-history'
import { createThreadListAdapter } from '@i-thinking/chat/adapters/thread-list'
import { useMemo, type ReactNode } from 'react'

import { chatModelPort, findHostOptions, historyPort } from '@/features/agent/port/instance'

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
 * 与 studio 的差别：这里不需要「把归属发回列表项」那一步 —— 客户端的 `createThread` 端口
 * 在落库时就把 `workspaceID` 写定了（读的是创建那一刻的工作区指针），列表项不必再补一次。
 */
function useThreadIdentity(): ThreadIdentity {
  const aui = useAui()

  /** 「这一线程的那次建会话」放在 ref 里：它在渲染之外被读写，且要跨重渲染活着 */
  const created = useMemo(function () {
    return { current: null as { localID: string; task: Promise<string> } | null }
  }, [])

  return useMemo(
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

        const task = createSessionID()
        created.current = { localID, task }
        return task
      }

      async function createSessionID(): Promise<string> {
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
}

function useThreadHistory(identity: ThreadIdentity): ThreadHistoryAdapter {
  return useMemo(
    function () {
      return createThreadHistoryAdapter(historyPort, identity)
    },
    [identity]
  )
}

function useThreadRuntime(): AssistantRuntime {
  const identity = useThreadIdentity()

  return useLocalRuntime(
    createChatModelAdapter(chatModelPort, {
      // 运行也要权威会话 id：控制器按它定位会话与票据，读空值会另起一个 goose 会话
      findHost: async function (target) {
        return findHostOptions(target, await identity.ensure())
      }
    }),
    {
      adapters: {
        history: useThreadHistory(identity)
      }
    }
  )
}

function AgentRuntimeProvider(props: { children: ReactNode }) {
  const list = useMemo(function () {
    return createThreadListAdapter(historyPort)
  }, [])

  const runtime = useRemoteThreadListRuntime({ adapter: list, runtimeHook: useThreadRuntime })

  return <AssistantRuntimeProvider runtime={runtime}>{props.children}</AssistantRuntimeProvider>
}

export { AgentRuntimeProvider }
