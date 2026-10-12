/**
 * 消息气泡渲染：思考折叠 + Markdown + 结构化部件分发
 */
import { Icon } from '@iconify/react/offline'
import { TooltipIconButton } from '@i-thinking/design/assistant/tooltip-icon-button'
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from '@i-thinking/design/assistant/reasoning'
import { Button } from '@i-thinking/design/components/button'
import { useState } from 'react'

import { MarkdownText } from './markdown-text'
import { parseParts } from '@/features/agent/model/tools'
import { CodeDiff } from './code-diff'
import { CompareTable } from './compare-table'
import { FileCard } from './file-card'
import { PlanList } from './plan-list'
import type { Message } from '@/stores/agent'
import type { PlanPartData } from '@/features/agent/types'

interface MessageHandlers {
  onApplyDiff?: (messageID: string, partIndex: number) => Promise<void>
  onTogglePlanItem?: (messageID: string, partIndex: number, itemIndex: number) => Promise<void>
  onWritePlanToCalendar?: (messageID: string, partIndex: number) => Promise<void>
  onOpenPlanPane?: (messageID: string, partIndex: number, data: PlanPartData) => void
  onCopyMessage?: (messageID: string) => void
  onDeleteMessage?: (messageID: string) => void
}

interface AgentMessageProps extends MessageHandlers {
  message: Message
  /** 是否正在流式输出（思考条闪烁态） */
  streaming?: boolean
}

/** 移除首个 JSON 代码块：结构化部件已接管展示，避免重复渲染原始 JSON */
function stripJsonBlock(fragment: string) {
  return fragment.replace(/```json\s*[\s\S]*?```/i, '').trim()
}

function AgentMessage(props: AgentMessageProps) {
  const { message, streaming } = props
  const [expandedThinking, updateExpandedThinking] = useState(false)

  const parts = parseParts(message.parts)
  const hasStructured = parts.some(function (part) {
    return part.type === 'compare' || part.type === 'plan'
  })
  const fragment = hasStructured ? stripJsonBlock(message.fragment) : message.fragment
  const showActions =
    message.identity === 'assistant' && !streaming && (fragment || parts.length > 0)

  return (
    <div className="flex flex-col gap-2">
      {message.thinking && message.identity === 'assistant' && (
        <ReasoningRoot
          variant="ghost"
          open={expandedThinking}
          onOpenChange={updateExpandedThinking}>
          <ReasoningTrigger
            active={Boolean(streaming)}
            label={streaming ? '思考中' : '思考过程'}
          />
          <ReasoningContent>
            <ReasoningText>{message.thinking}</ReasoningText>
          </ReasoningContent>
        </ReasoningRoot>
      )}
      {fragment && <MarkdownText content={fragment} />}
      {parts.map(function (part, partIndex) {
        switch (part.type) {
          case 'file':
            return (
              <FileCard
                key={`file-${partIndex}`}
                data={part.data}
              />
            )
          case 'compare':
            return (
              <CompareTable
                key={`compare-${partIndex}`}
                data={part.data}
              />
            )
          case 'plan':
            return (
              <div
                key={`plan-${partIndex}`}
                className="flex flex-col gap-2">
                <PlanList
                  data={part.data}
                  onToggleItem={function (itemIndex) {
                    void props.onTogglePlanItem?.(message.id, partIndex, itemIndex)
                  }}
                  onWriteCalendar={function () {
                    return props.onWritePlanToCalendar?.(message.id, partIndex) ?? Promise.resolve()
                  }}
                />
                {props.onOpenPlanPane ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="self-start px-0"
                    onClick={function () {
                      props.onOpenPlanPane?.(message.id, partIndex, part.data)
                    }}>
                    在侧栏打开
                  </Button>
                ) : null}
              </div>
            )
          case 'diff':
            return (
              <CodeDiff
                key={`diff-${partIndex}`}
                part={part}
                onApply={function () {
                  return props.onApplyDiff?.(message.id, partIndex) ?? Promise.resolve()
                }}
              />
            )
          case 'tool':
            return (
              <div
                key={`tool-${part.data.toolCallId || partIndex}`}
                className="text-muted-foreground flex items-center gap-1.5 text-xs opacity-90">
                <Icon
                  icon={
                    part.data.status === 'running'
                      ? 'mdi:loading'
                      : part.data.status === 'error'
                        ? 'mdi:alert-circle-outline'
                        : 'mdi:wrench-outline'
                  }
                  width={14}
                  height={14}
                />
                <span>
                  {part.data.status === 'running'
                    ? `调用 ${part.data.name}…`
                    : part.data.status === 'error'
                      ? `${part.data.name} 失败`
                      : `已调用 ${part.data.name}`}
                </span>
              </div>
            )
        }
      })}
      {showActions && (
        <div className="flex items-center gap-1">
          <TooltipIconButton
            tooltip="复制"
            onClick={function () {
              props.onCopyMessage?.(message.id)
            }}>
            <Icon
              icon="lucide:copy"
              className="size-3.5"
            />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="删除"
            onClick={function () {
              props.onDeleteMessage?.(message.id)
            }}>
            <Icon
              icon="lucide:trash-2"
              className="size-3.5"
            />
          </TooltipIconButton>
        </div>
      )}
    </div>
  )
}

export { AgentMessage }
export type { AgentMessageProps, MessageHandlers }
