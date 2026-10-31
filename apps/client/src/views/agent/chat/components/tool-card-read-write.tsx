import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { useState } from 'react'
import { Icon } from '@iconify/react/offline'
import { CodeBlock } from '@cogito/design/assistant/code-block'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@cogito/design/assistant/tool'
import { Button } from '@cogito/design/components/button'

import { toAgentToolLabel } from '@/features/agent/tool-labels'
import { openAsideReview } from '@/views/agent/chat/components/open-aside-review'
import {
  findBaseName,
  findCodeLanguage,
  findWritePath,
  mapToolCallState,
  parseWriteDiffStat,
  type WriteDiffStat
} from '@/views/agent/chat/components/parse-tool-result'
import { formatDetail, summarize } from '@/views/agent/chat/components/tool-card-format'

function FileChangeStat(props: WriteDiffStat) {
  if (props.added <= 0 && props.removed <= 0) return null
  return (
    <span className="font-mono text-[11px] tabular-nums tracking-tight">
      {props.added > 0 ? <span className="text-success">+{props.added}</span> : null}
      {props.added > 0 && props.removed > 0 ? <span className="text-muted-foreground"> </span> : null}
      {props.removed > 0 ? <span className="text-destructive">-{props.removed}</span> : null}
    </span>
  )
}

function ReadWriteWritePath(props: { writePath: string }) {
  return (
    <p
      className="text-muted-foreground truncate px-0.5 font-mono text-[11px]"
      title={props.writePath}>
      {props.writePath}
    </p>
  )
}

function ReadWriteDiffButton(props: { writePath: string }) {
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 rounded-md"
        onClick={function () {
          openAsideReview(props.writePath)
        }}>
        <Icon icon="lucide:git-compare" />
        查看 diff
      </Button>
    </div>
  )
}

function ReadWriteOutput(props: {
  result: unknown
  outputText: string
  language: string
  isError: boolean
}) {
  if (props.result === undefined) return null
  return (
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
                  language={props.language}
                  showHeader={false}
                  contentClassName="max-h-[min(36vh,20rem)]"
                />
              )
            : formatDetail(props.result)
      }
      errorText={props.isError ? props.outputText || '执行出错' : undefined}
    />
  )
}

function ReadWriteToolCard(
  props: ToolCallMessagePartProps & {
    variant: 'read' | 'write' | 'search'
    outputText: string
  }
) {
  const state = mapToolCallState(props)
  const label = toAgentToolLabel(props.toolName)
  const summary = summarize(props.args)
  const writePath = props.variant === 'write' ? findWritePath(props.args) : null
  const diffStat = props.variant === 'write' ? parseWriteDiffStat(props.args) : null
  const isRunning = props.status?.type === 'running'
  const shouldExpand = isRunning || state === 'approval-requested'
  // 运行中/待审批时强制展开；手动展开的选择用 pinned 记住，不在 effect 里追 prop。
  const [isPinnedOpen, setPinnedOpen] = useState(false)
  const open = shouldExpand || isPinnedOpen
  const language = findCodeLanguage(props.toolName, props.args)
  const title =
    props.variant === 'write' && writePath
      ? findBaseName(writePath)
      : summary
        ? `${label} · ${summary}`
        : label

  return (
    <Tool
      open={open}
      onOpenChange={setPinnedOpen}
      className="my-1 mb-0">
      <ToolHeader
        title={title}
        state={state}
        toolName={props.toolName}
        annotation={diffStat ? <FileChangeStat {...diffStat} /> : null}
      />
      <ToolContent>
        {writePath ? <ReadWriteWritePath writePath={writePath} /> : null}
        <ToolInput input={props.args as unknown} />
        {writePath ? <ReadWriteDiffButton writePath={writePath} /> : null}
        <ReadWriteOutput
          result={props.result}
          outputText={props.outputText}
          language={language}
          isError={props.isError === true}
        />
      </ToolContent>
    </Tool>
  )
}

export { ReadWriteToolCard }
