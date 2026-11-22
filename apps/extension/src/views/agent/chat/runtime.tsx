/**
 * 对话 runtime：会话列表自建，生成走 `ChatModelPort`。
 *
 * 与 client 的 `views/agent/chat/runtime.tsx` 是同一套装配（`useRemoteThreadListRuntime`
 * + `useLocalRuntime` + `createThreadListAdapter`），差别只在端口后面接的是什么：
 * client 接 Tauri 命令与 agentd 直连，这里接本机 client 的代理。
 */
import {
  AssistantRuntimeProvider,
  useAui,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  type AssistantRuntime
} from '@assistant-ui/react'
import { createChatModelAdapter } from '@cogito/chat/adapters/chat-model'
import { createThreadHistoryAdapter } from '@cogito/chat/adapters/thread-history'
import type { ThreadIdentity } from '@cogito/chat/adapters/thread-history'
import { createThreadListAdapter } from '@cogito/chat/adapters/thread-list'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import type { AssistantLabelsOverride } from '@cogito/design/assistant/labels'
import { useMemo, useRef, type ReactNode } from 'react'

import { chatModelPort, findHostOptions, historyPort } from '@/features/agent/port/instance.ts'

/**
 * 只覆盖首版真正会显示的几条中文。
 *
 * 刻意不把 client 那份全量文案抄过来：那是**第二份真源**，改一边另一边就不一致。
 * 等文案需求稳定后把它上提到 `@cogito/chat/labels`，两端 import 同一份。
 */
const LABELS_ZH: AssistantLabelsOverride = {
  newThread: '新建对话',
  searchThreads: '搜索会话',
  noThreads: '还没有会话',
  loadingThreads: '正在加载会话',
  untitledThread: '新对话',
  welcome: '我能帮你做点什么？',
  composerPlaceholder: '发消息…',
  messageInput: '消息输入框',
  scrollToBottom: '滚动到底部',
  addAttachment: '添加附件',
  send: '发送',
  stopGenerating: '停止生成',
  copy: '复制',
  reload: '重新生成',
  edit: '编辑',
  cancel: '取消',
  delete: '删除',
  rename: '重命名',
  renameThread: '重命名会话',
  moreOptions: '更多操作',
  running: '运行中',
  working: '思考中…',
  completedRun: '已完成',
  stoppedRun: '已停止生成'
}

/**
 * 会话身份：会话 id 是**落库后**才存在的。
 *
 * - `resolve()`（读历史）：拿不到就返回 null，**不能**顺手把空会话建出来
 * - `ensure()`（写历史 / 发起运行）：拿不到就抛错（assistant-ui 会吞掉写入失败，必须留痕）
 */
function useThreadIdentity(): ThreadIdentity {
  const aui = useAui()
  /** 同一线程的首次写入有多个并发调用方：不记住就会建出两条会话行 */
  const created = useRef<{ localID: string; task: Promise<string> } | null>(null)

  return useMemo(
    function () {
      function itemState() {
        return aui.threadListItem.getState()
      }

      async function resolve(): Promise<string | null> {
        const known = itemState().remoteId ?? null
        if (known) return known
        // 全新会话还没落库：读路径不该把它建出来
        if (itemState().status === 'new') return null
        return (await aui.threadListItem.initialize()).remoteId ?? itemState().remoteId ?? null
      }

      function ensure(): Promise<string> {
        const localID = itemState().id
        const cached = created.current
        if (cached && cached.localID === localID) return cached.task

        const task = (async function () {
          const known = itemState().remoteId
          if (known) return known
          const remoteID = (await aui.threadListItem.initialize()).remoteId
          if (!remoteID) throw new Error('会话初始化未返回 id')
          return remoteID
        })().catch(function (error: unknown) {
          console.error('[chat] 会话 id 解析失败，本条历史写入被丢弃', error)
          throw error
        })
        created.current = { localID, task }
        return task
      }

      return { resolve, ensure }
    },
    [aui]
  )
}

function useThreadRuntime(): AssistantRuntime {
  const identity = useThreadIdentity()

  const history = useMemo(
    function () {
      return createThreadHistoryAdapter(historyPort, identity)
    },
    [identity]
  )

  // adapter 与 options 都要稳定引用：每次 render 新建对象会让「换 adapter」不可推理
  const adapter = useMemo(
    function () {
      return createChatModelAdapter(chatModelPort, {
        findHost: async function () {
          return findHostOptions(await identity.ensure())
        }
      })
    },
    [identity]
  )

  const options = useMemo(
    function () {
      return {
        // 运行中发送进队列，当前轮结束后再 FIFO 开新 turn
        unstable_enableMessageQueue: true,
        unstable_queueClearOnCancel: false,
        adapters: { history }
      }
    },
    [history]
  )

  return useLocalRuntime(adapter, options)
}

function AgentChatRuntime(props: { children: ReactNode }) {
  const list = useMemo(function () {
    return createThreadListAdapter(historyPort)
  }, [])
  const runtime = useRemoteThreadListRuntime({ adapter: list, runtimeHook: useThreadRuntime })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantLabelsProvider labels={LABELS_ZH}>{props.children}</AssistantLabelsProvider>
    </AssistantRuntimeProvider>
  )
}

export { AgentChatRuntime, LABELS_ZH }
