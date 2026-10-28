/**
 * 磁贴内对话坞：右侧可折叠面板，全程不跳页。
 *
 * 设计取舍（与聊天页一致、与弹窗相反）：
 * - **一次点击就开跑**：动作按钮直接发一句话（带当前文档/选区），不需要用户先填提示词；
 * - **先建议后应用**：结果留在对话里，落到文档/草稿由消息上的按钮完成；
 * - **折叠不卸载**：会话与消息都留在 local runtime 里，收起只是变窄。
 */
import { useAuiState } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Thread } from '@cogito/design/assistant/thread.aui'
import { clsx } from 'clsx'
import { useState } from 'react'

import { AgentToolCard } from '@/views/agent/chat/components/tool-card'

import { toFullChat } from './handoff'
import { DockRuntime } from './runtime'
import { useDockStore } from './store'
import type { DockAction, DockScope } from './types'

/** 把最后一条助手回复写回宿主（知识库 = 插入/替换选区）。没有落点的域不渲染 */
function DockApply({ scope }: { scope: DockScope }) {
  const lastAssistant = useAuiState(function (state) {
    const messages = state.thread.messages
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'assistant') continue
      const text = message.content
        .map(function (part) {
          return part.type === 'text' ? part.text : ''
        })
        .join('')
        .trim()
      if (text) return text
    }
    return ''
  })
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })

  if (!scope.toApply) return null

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={!lastAssistant || isRunning}
      title="把上一条回复写进编辑器（一次操作，可撤销）"
      onClick={function () {
        scope.toApply?.(lastAssistant)
      }}>
      <Icon
        icon="lucide:corner-down-left"
        className="size-3.5"
      />
      应用到文档
    </Button>
  )
}

/** 把这一轮最新的用户消息带到完整会话（dock → 聊天页的唯一交接口） */
function DockEscalate() {
  const lastUser = useAuiState(function (state) {
    const messages = state.thread.messages
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'user') continue
      const text = message.content
        .map(function (part) {
          return part.type === 'text' ? part.text : ''
        })
        .join('')
        .trim()
      if (text) return text
    }
    return ''
  })
  const [isBusy, toSetBusy] = useState(false)

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={!lastUser || isBusy}
      onClick={function () {
        toSetBusy(true)
        toFullChat(lastUser)
      }}>
      <Icon
        icon="lucide:external-link"
        className="size-3.5"
      />
      完整会话
    </Button>
  )
}
function DockWelcome({ scope }: { scope: DockScope }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <Icon
        icon="lucide:sparkles"
        className="size-6 text-muted-foreground"
      />
      <p className="text-xs text-muted-foreground">{scope.hint}</p>
    </div>
  )
}

function DockActionBar({ scope }: { scope: DockScope }) {
  const toOpen = useDockStore(function (state) {
    return state.toOpen
  })

  return (
    <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
      {scope.actions.map(function (action: DockAction) {
        // buildPrompt 是纯读取：返回 null 表示当前上下文用不了（没有选区等）
        const isAvailable = action.buildPrompt() !== null
        return (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant="outline"
            disabled={!isAvailable}
            className="h-7 gap-1 px-2 text-xs font-normal"
            onClick={function () {
              toOpen(action.id)
            }}>
            {action.icon ? (
              <Icon
                icon={action.icon}
                className="size-3.5"
              />
            ) : null}
            {action.label}
          </Button>
        )
      })}
    </div>
  )
}

function AgentDock(props: { className?: string }) {
  const scope = useDockStore(function (state) {
    return state.scope
  })
  const isOpen = useDockStore(function (state) {
    return state.isOpen
  })
  const resetKey = useDockStore(function (state) {
    return state.resetKey
  })
  const toClose = useDockStore(function (state) {
    return state.toClose
  })
  const toReset = useDockStore(function (state) {
    return state.toReset
  })

  if (!scope) return null

  return (
    <aside
      aria-hidden={!isOpen}
      className={clsx(
        'flex h-full min-h-0 flex-col border-border bg-background',
        isOpen ? 'w-80 border-l' : 'pointer-events-none w-0 overflow-hidden opacity-0',
        props.className
      )}>
      <header className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Icon
          icon="lucide:sparkles"
          className="ml-1 size-3.5 text-muted-foreground"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{scope.title}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          title="新对话"
          onClick={toReset}>
          <Icon
            icon="lucide:rotate-ccw"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          title="收起"
          onClick={toClose}>
          <Icon
            icon="lucide:panel-right-close"
            className="size-3.5"
          />
        </Button>
      </header>
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ ['--thread-max-width' as string]: '100%' }}>
        <DockRuntime
          key={`${scope.key}:${resetKey}`}
          scope={scope}>
          <DockActionBar scope={scope} />
          <div className="min-h-0 flex-1">
            <Thread
              components={{
                Welcome: function DockWelcomeSlot() {
                  return <DockWelcome scope={scope} />
                },
                ToolFallback: AgentToolCard
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1">
            <DockApply scope={scope} />
            <DockEscalate />
          </div>
        </DockRuntime>
      </div>
    </aside>
  )
}

export { AgentDock }
