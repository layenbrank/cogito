/**
 * Agent 工具卡：design AI Elements + 启发式 P0/P1 分派。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { useMemo } from 'react'

import { parseToolCard, parseWebSources } from '@/views/agent/chat/components/parse-tool-result'
import { ApprovalBar } from '@/views/agent/chat/components/tool-card-approval-bar'
import { ToolCardShellBody } from '@/views/agent/chat/components/tool-card-body'
import { SourcesBlock } from '@/views/agent/chat/components/tool-card-sources-block'

function AgentToolCard(props: ToolCallMessagePartProps) {
  const parsed = useMemo(
    function () {
      return parseToolCard(props.toolName, props.args, props.result)
    },
    [props.toolName, props.args, props.result]
  )
  const sources = useMemo(
    function () {
      return parseWebSources(props.toolName, props.args, props.result, parsed.text)
    },
    [props.toolName, props.args, props.result, parsed.text]
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
      <SourcesBlock sources={sources} />
      <ApprovalBar
        approval={props.approval}
        toolCallId={props.toolCallId}
      />
    </div>
  )
}

export { AgentToolCard }
