import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { useState } from 'react'
import { CodeBlock } from '@cogito/design/assistant/code-block'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@cogito/design/assistant/tool'

import { toAgentToolLabel } from '@/features/agent/tool-labels'
import { mapToolCallState } from '@/views/agent/chat/components/parse-tool-result'
import type { ParsedToolCard } from '@/views/agent/chat/components/parse-tool-result'
import { formatDetail } from '@/views/agent/chat/components/tool-card-format'
import { ReadWriteToolCard } from '@/views/agent/chat/components/tool-card-read-write'
import { ToolCardSandboxBody } from '@/views/agent/chat/components/tool-card-sandbox-body'
import { SpecialToolBody } from '@/views/agent/chat/components/tool-card-special-body'
import { ToolCardTerminalBody } from '@/views/agent/chat/components/tool-card-terminal-body'
import { toShellCommand } from '@/views/agent/chat/components/tool-output'

function ToolCardFallbackBody(props: ToolCallMessagePartProps & { outputText: string; label: string }) {
  const isRunning = props.status?.type === 'running'
  const state = mapToolCallState(props)
  const shouldExpand = isRunning || state === 'approval-requested'
  // 运行中/待审批时强制展开；用户手动展开的选择用 pinned 记住，结束后保持该选择（未手动展开的随结束收起）。
  // 不用 effect 同步：effect 会先渲染一帧旧值，且属于「渲染中派生即可」的场景。
  const [isPinnedOpen, setPinnedOpen] = useState(false)
  const open = shouldExpand || isPinnedOpen
  return (
    <Tool
      open={open}
      onOpenChange={setPinnedOpen}
      className="my-1 mb-0">
      <ToolHeader
        title={props.label}
        state={state}
        toolName={props.toolName}
      />
      <ToolContent>
        <ToolInput input={props.args as unknown} />
        {props.result !== undefined ? (
          <ToolOutput
            output={
              props.isError
                ? props.outputText
                  ? undefined
                  : formatDetail(props.result)
                : props.outputText
                  ? (
                      <CodeBlock
                        code={props.outputText}
                        language="json"
                      />
                    )
                  : formatDetail(props.result)
            }
            errorText={props.isError ? props.outputText || '执行出错' : undefined}
          />
        ) : null}
      </ToolContent>
    </Tool>
  )
}

function ToolCardShellBody(props: ToolCallMessagePartProps & { parsed: ParsedToolCard }) {
  const { text: outputText, special, variant } = props.parsed
  const label = toAgentToolLabel(props.toolName)

  if (special && variant === special.kind) {
    return <SpecialToolBody special={special} />
  }
  if (variant === 'command' && toShellCommand(props.args)) {
    return (
      <ToolCardTerminalBody
        {...props}
        outputText={outputText}
      />
    )
  }
  if (variant === 'code') {
    return (
      <ToolCardSandboxBody
        {...props}
        outputText={outputText}
        label={label}
      />
    )
  }
  if (variant === 'read' || variant === 'write' || variant === 'search') {
    return (
      <ReadWriteToolCard
        {...props}
        variant={variant}
        outputText={outputText}
      />
    )
  }
  return (
    <ToolCardFallbackBody
      {...props}
      outputText={outputText}
      label={label}
    />
  )
}

export { ToolCardShellBody }
