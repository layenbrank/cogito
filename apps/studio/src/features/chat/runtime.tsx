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
import {
  createThreadHistoryAdapter,
  type ThreadIdentity
} from '@cogito/chat/adapters/thread-history'
import { createThreadListAdapter } from '@cogito/chat/adapters/thread-list'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

import { createHistoryPort } from '@/features/chat/port/history.ts'
import { chatModelPort, findHostOptions } from '@/features/chat/port/instance.ts'

/**
 * Chat runtime：**一条通路**。
 *
 * 会话列表自建（`useRemoteThreadListRuntime`），生成统一走 `useLocalRuntime` +
 * `ChatModelPort` —— 不管跑的是本机 Ollama 还是平台网关，请求都由主进程发出，
 * 所以工具、审批、计划、用量、历史全套能力两边一致；差别只在主进程按 provider 的
 * kind 解析凭据（见 `features/chat/platform.ts` 与 `host/capabilities/assistant/model.ts`）。
 *
 * 这里曾经有两个 runtime hook（`offline` / `online`）加外层 `key={kind}` 重建整棵树：
 * 那种设计把「模型」绑在了通路上，等于同一份能力写两遍。
 *
 * 会话归属**不问「当前是哪个会话」**：`runtimeHook` 每个线程各调一次，而库允许用户切走
 * 之后原会话继续跑（历史在运行结束才落库）—— 那时「当前」已经是别人了。所以这里握住
 * 本线程自己的 aui client，惰性读它落库后的 id（新建线程要先 `initialize()` 才有）。
 */

const historyPort = createHistoryPort()

/**
 * 把会话的**归属**发回列表项 —— 左栏按条目的 `custom.workspaceID` 归拢会话
 * （见 `views/agent/chat/components/thread-groups.ts`）。
 *
 * 库**不会**把 `createThread` 拿到的 `custom` 带回来（`initialize()` 的返回契约只有
 * `remoteId` / `externalId`），所以新建会话的归属得在这里补一次：不补，它在左栏就落到
 * 「未关联工作区」，直到列表重载（重启）才归位。
 *
 * 归属读**落库的那一行**，而不是重读一次「当前工作区」指针：`createThread` 解析完指针才
 * 落库，两次读之间用户可能已经切了工作区 —— 那样左栏显示的和库里存的就对不上了。
 *
 * 失败不抛：列表项的归属只是侧栏分组的乐观视图（库里那行仍然是对的），不该连累这次写入。
 */
async function publishAssociation(aui: AssistantClient, threadID: string): Promise<void> {
  try {
    const item = aui.threadListItem.getState()
    // 老会话的归属随 `list()` 一起来（`custom` 里已经带着这个键）—— 不必再问一次库
    if (item.custom && 'workspaceID' in item.custom) return

    const thread = await historyPort.findThread(threadID)
    if (!thread) return
    aui.threadListItem.updateCustom({ ...item.custom, workspaceID: thread.workspaceID })
  } catch (error) {
    console.warn('[CHAT] 会话归属未能发回列表项', error)
  }
}

/**
 * 本线程的 DB 会话 id。
 *
 * **同步快照会骗人**：会话 id 是落库后才有的，而列表项状态（`remoteId`）在
 * promotion / reconcile 期间可能还停在空值上。直接拿这个空值去用，代价是静默的：
 * 写历史 → 撞外键 + assistant-ui 吞掉 rejection（「消息发出去了，库里没有」）；
 * 取 host → 空值被结构化克隆丢掉 → 主进程按 null 记用量、另起一个 opencode 会话
 * （「花了 token 却没算到会话上」）。
 *
 * 所以身份只认两件事：库里的权威 id，或者明确的失败。
 * - `resolve()`：读路径（`load()`）。不建会话，拿不到就返回 null
 * - `ensure()`：写路径（历史写入、运行取 host）。拿不到 id 就抛错
 */
function useThreadIdentity(): ThreadIdentity {
  const aui = useAui()
  /**
   * 落库之后才有的权威 id —— 归属的发布挂在**这个跳变**上。
   *
   * 为什么不能挂在 `ensure()` 上：`ensure()` 是「要不要建会话」的兜底，而库自己会抢先建
   * —— `RemoteThreadResource` 一看到本线程开始写内容就调 `threadListItem.initialize()`，
   * 于是新建会话这件事大多数时候轮不到 `ensure()`，挂在那里等于不发布。
   */
  const remoteId = useAuiState(function (state) {
    return state.threadListItem.remoteId
  })

  // 「这一线程的那次建会话」放在 ref 里：它在渲染之外被读写，且要跨重渲染活着
  const created = useRef<{ localID: string; task: Promise<string> } | null>(null)

  const identity = useMemo(
    function () {
      function itemState() {
        return aui.threadListItem.getState()
      }

      /**
       * 权威 id。快照为空时问库要：对 regular / archived 项，`initialize()` 只是 await
       * 列表项已有的初始化任务（幂等，不会再建会话）；只有全新会话（`status === 'new'`）
       * 才需要落库，而那是 `ensure()` 的职责。
       */
      async function resolve(): Promise<string | null> {
        const known = itemState().remoteId ?? null
        if (known) return known
        if (itemState().status === 'new') return null
        return (await aui.threadListItem.initialize()).remoteId ?? itemState().remoteId ?? null
      }

      /**
       * 同一线程的首次写入有多个并发调用方（历史 append、运行取 host），而库里
       * 「建会话」不是互斥的：并起来会建出两条会话行 —— 历史写进第一条、用量与
       * opencode 会话挂到第二条，于是「消息在 1 号会话里，账却记在 2 号会话上」。
       *
       * 而且这个窗口比「`initialize()` 有没有返回」更长：库把 `remoteId` 发布到列表项
       * 状态上是异步的，紧随其后的那次 `ensure()` 仍可能读到空快照。所以结果要**按线程
       * 记住**（键用列表项 id：新建时是 `__LOCALID_x`，落库后库也只补 `remoteId`，它不变），
       * 而不是等 promise 落地就清掉。
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

        const created = await aui.threadListItem.initialize()
        const createdID = created?.remoteId ?? itemState().remoteId ?? null
        if (!createdID) throw new Error('[CHAT] 会话初始化后仍没有 id，本次写入被拒绝')
        return createdID
      }

      return { resolve, ensure }
    },
    [aui]
  )

  // 不 await：`updateCustom` 同步改列表项状态（乐观），落库在后台 —— 首条消息不该等它
  useEffect(
    function () {
      if (!remoteId) return
      void publishAssociation(aui, remoteId)
    },
    [aui, remoteId]
  )

  return identity
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
      // 运行也要权威会话 id：主进程按它记 `studio 线程 → opencode 会话`，读空值会另起一个
      // opencode 会话且映射写不回去（下一轮又把整段历史重发）
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

function ChatRuntimeProvider(props: { children: ReactNode }) {
  const list = useMemo(function () {
    return createThreadListAdapter(historyPort)
  }, [])

  const runtime = useRemoteThreadListRuntime({ adapter: list, runtimeHook: useThreadRuntime })

  return <AssistantRuntimeProvider runtime={runtime}>{props.children}</AssistantRuntimeProvider>
}

export { ChatRuntimeProvider }
