import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { CodeBlock } from '@cogito/design/assistant/code-block'
import {
  Sandbox,
  SandboxContent,
  SandboxHeader,
  SandboxTabContent,
  SandboxTabs,
  SandboxTabsBar,
  SandboxTabsList,
  SandboxTabsTrigger
} from '@cogito/design/assistant/sandbox'

import { mapToolCallState } from '@/views/agent/chat/components/parse-tool-result'
import { toCodeSource } from '@/views/agent/chat/components/tool-output'

function ToolCardSandboxBody(
  props: ToolCallMessagePartProps & { outputText: string; label: string }
) {
  const codeSource = toCodeSource(props.args)
  if (!codeSource) return null
  const state = mapToolCallState(props)

  return (
    <Sandbox
      defaultOpen
      className="my-1 mb-0">
      <SandboxHeader
        title={props.label}
        state={state}
      />
      <SandboxContent>
        <SandboxTabs defaultValue="code">
          <SandboxTabsBar>
            <SandboxTabsList>
              <SandboxTabsTrigger value="code">代码</SandboxTabsTrigger>
              <SandboxTabsTrigger value="output">输出</SandboxTabsTrigger>
            </SandboxTabsList>
          </SandboxTabsBar>
          <SandboxTabContent value="code">
            <CodeBlock
              code={codeSource}
              language="javascript"
            />
          </SandboxTabContent>
          <SandboxTabContent value="output">
            {props.outputText ? (
              <CodeBlock
                code={props.outputText}
                language="markdown"
              />
            ) : (
              <p className="text-muted-foreground px-3 py-2 text-xs">暂无输出</p>
            )}
          </SandboxTabContent>
        </SandboxTabs>
      </SandboxContent>
    </Sandbox>
  )
}

export { ToolCardSandboxBody }
