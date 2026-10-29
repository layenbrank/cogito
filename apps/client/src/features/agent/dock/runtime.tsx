/**
 * dock 的运行时：assistant-ui 的 local runtime + 聊天页同一套端口。
 *
 * 与聊天页的区别只有两点：
 * 1. 会话身份是 `dock:<scopeKey>`（不落 `agent_session`，也就不会出现在会话列表里）；
 * 2. 系统提示固定为域 playbook，不读全局场景。
 */
import { AssistantRuntimeProvider, useAui, useLocalRuntime } from '@assistant-ui/react'
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { createChatModelAdapter } from '@cogito/chat/adapters/chat-model'
import { useEffect, useMemo, type ReactNode } from 'react'

import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'

import { buildDockPort, writeDockRunText } from './port'
import { useDockStore } from './store'
import type { DockScope } from './types'

interface DockRuntimeProps {
  scope: DockScope
  children: ReactNode
}

/**
 * 一键动作的执行者：挂到 composer 上「填好+发送」。
 *
 * 用 composer 而不是直接 append：走的是真实发送路径（配额检查、附件、审批都照常）。
 * 可见消息只放动作标签，组合提示词（带全文/选区/定义）经 writeDockRunText 交给端口覆盖。
 */
function DockActionRunner({ scope }: { scope: DockScope }) {
  const aui = useAui()
  const pendingAction = useDockStore(function (state) {
    return state.pendingAction
  })
  const pendingText = useDockStore(function (state) {
    return state.pendingText
  })

  useEffect(
    function () {
      if (!pendingAction && !pendingText) return
      const pending = useDockStore.getState().toTakePending()

      if (pending.actionID) {
        const action = scope.actions.find(function (item) {
          return item.id === pending.actionID
        })
        const composed = action?.buildPrompt()
        if (!action || !composed) return
        // 组合提示词不进输入框：可见的只是一句动作标签
        writeDockRunText(composed)
        aui.composer.setText(action.label)
      } else if (pending.text) {
        // toAsk 是用户自己的话，原样显示
        aui.composer.setText(pending.text)
      }
      aui.composer.send()
    },
    [pendingAction, pendingText, scope, aui]
  )

  return null
}

function DockRuntime({ scope, children }: DockRuntimeProps) {
  const adapter = useMemo(
    function () {
      return createChatModelAdapter(buildDockPort(function () {
        return scope
      }), {
        findHost: function () {
          // 会话 id 只在本埞内有意义：ACP 侧按它缓存，折叠/展开不会重开会话
          return Promise.resolve({ threadID: `dock:${scope.key}` })
        }
      })
    },
    [scope]
  )
  const runtime = useLocalRuntime(adapter)

  return (
    <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
      <AssistantRuntimeProvider runtime={runtime}>
        <DockActionRunner scope={scope} />
        {children}
      </AssistantRuntimeProvider>
    </AssistantLabelsProvider>
  )
}

export { DockRuntime }
