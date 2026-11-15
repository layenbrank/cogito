/**
 * Agent 工具卡：design AI Elements + 启发式 P0/P1 分派。
 *
 * 首屏用同步 parse；有结果后异步走 Rust normalize（失败仍保留同步结果）。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { memo, useEffect, useState } from 'react'

import {
  parseToolCard,
  parseToolCardAsync,
  type ParsedToolCard
} from '@/views/agent/chat/components/parse-tool-result'
import { ApprovalBar } from '@/views/agent/chat/components/tool-card-approval-bar'
import { ToolCardShellBody } from '@/views/agent/chat/components/tool-card-body'

function AgentToolCardInner(props: ToolCallMessagePartProps) {
  const [parsed, updateParsed] = useState<ParsedToolCard>(function () {
    return parseToolCard(props.toolName, props.args, props.result)
  })

  useEffect(
    function () {
      const sync = parseToolCard(props.toolName, props.args, props.result)
      updateParsed(sync)
      let cancelled = false
      void parseToolCardAsync(props.toolName, props.args, props.result)
        .then(function (next) {
          if (!cancelled) updateParsed(next)
        })
        .catch(function (error: unknown) {
          console.warn('[agent] parseToolCardAsync 失败，保留同步结果:', error)
        })
      return function () {
        cancelled = true
      }
    },
    [props.toolName, props.args, props.result]
  )

  return (
    <div
      data-slot="agent-tool-card"
      data-variant={parsed.variant}
      className="my-1 flex flex-col gap-1.5 overflow-hidden">
      <ToolCardShellBody
        {...props}
        parsed={parsed}
      />
      {/* 来源芯片在消息级（`thread.aui.tsx` 的 MessageSources）统一渲染：
          一条回答可能调了多次检索，按工具卡重复列一遍只会把同一条链接摆三回 */}
      <ApprovalBar {...props} />
    </div>
  )
}

/**
 * 状态 / 审批只比**标量**：适配器每推一个快照都会新建 `status` / `approval` 字面量，
 * 比引用永远不相等 —— 那样比较器形同虚设，每 32ms 就让整条消息里所有工具卡重渲染一次。
 */
function isSameStatus(
  previous: ToolCallMessagePartProps['status'],
  next: ToolCallMessagePartProps['status']
): boolean {
  if (previous === next) return true
  if (!previous || !next) return false
  // reason 只在部分分支上存在，取不到就按 undefined 比
  const before = 'reason' in previous ? previous.reason : undefined
  const after = 'reason' in next ? next.reason : undefined
  return previous.type === next.type && before === after
}

function isSameApproval(
  previous: ToolCallMessagePartProps['approval'],
  next: ToolCallMessagePartProps['approval']
): boolean {
  if (previous === next) return true
  if (!previous || !next) return false
  return (
    previous.id === next.id &&
    previous.approved === next.approved &&
    previous.optionId === next.optionId &&
    previous.resolution === next.resolution &&
    previous.prompt === next.prompt &&
    (previous.options?.length ?? 0) === (next.options?.length ?? 0)
  )
}

/** 已完成工具卡在后续 token 流中保持引用稳定，避免跟随重绘 */
const AgentToolCard = memo(AgentToolCardInner, function (previous, next) {
  return (
    previous.toolCallId === next.toolCallId &&
    previous.toolName === next.toolName &&
    previous.args === next.args &&
    previous.result === next.result &&
    previous.isError === next.isError &&
    isSameStatus(previous.status, next.status) &&
    isSameApproval(previous.approval, next.approval)
  )
})

export { AgentToolCard }
