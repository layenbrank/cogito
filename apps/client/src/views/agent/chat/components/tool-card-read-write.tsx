import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react/offline'
import { CodeBlock } from '@cogito/design/assistant/code-block'
import { CodeDiff } from '@cogito/design/assistant/code-diff'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@cogito/design/assistant/tool'
import { Button } from '@cogito/design/components/button'

import { normalizeToolPath } from '@/features/agent/tool-paths'
import { toAgentToolLabel } from '@/features/agent/tool-labels'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { openAsideReview } from '@/views/agent/chat/components/open-aside-review'
import {
  findBaseName,
  findCodeLanguage,
  findWritePath,
  mapToolCallState,
  parseWriteCodeDiff,
  type WriteCodeDiff,
  type WriteDiffStat
} from '@/views/agent/chat/components/parse-tool-result'
import { formatDetail, summarize } from '@/views/agent/chat/components/tool-card-format'

function FileChangeStat(props: WriteDiffStat) {
  if (props.added <= 0 && props.removed <= 0) return null
  return (
    <span className="font-mono text-xs tabular-nums tracking-tight">
      {props.added > 0 ? <span className="text-success">+{props.added}</span> : null}
      {props.added > 0 && props.removed > 0 ? <span className="text-muted-foreground"> </span> : null}
      {props.removed > 0 ? <span className="text-destructive">-{props.removed}</span> : null}
    </span>
  )
}

function WorkspaceDiffAction(props: { relative: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-7 gap-1 rounded-md px-2 text-xs"
      title="在右栏查看 HEAD ↔ 工作区差异"
      onClick={function (event) {
        event.stopPropagation()
        openAsideReview(props.relative)
      }}>
      <Icon
        icon="lucide:git-compare"
        className="size-3.5"
      />
      工作区
    </Button>
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

function WriteCodeDiffBody(props: {
  args: unknown
  codeDiff: WriteCodeDiff | null
  writePath: string | null
  relativePath: string | null
  result: unknown
  outputText: string
  isError: boolean
}) {
  const { codeDiff } = props

  if (!codeDiff) {
    return (
      <>
        {props.writePath ? (
          <p
            className="text-muted-foreground truncate px-0.5 font-mono text-xs"
            title={props.writePath}>
            {props.relativePath ?? props.writePath}
          </p>
        ) : null}
        <ToolInput input={props.args} />
        {props.relativePath && !props.isError ? (
          <div className="flex justify-end">
            <WorkspaceDiffAction relative={props.relativePath} />
          </div>
        ) : null}
        <ReadWriteOutput
          result={props.result}
          outputText={props.outputText}
          language="markdown"
          isError={props.isError}
        />
      </>
    )
  }

  return (
    <>
      <CodeDiff
        filename={codeDiff.filename}
        subtitle={props.relativePath ?? undefined}
        additions={codeDiff.additions}
        deletions={codeDiff.deletions}
        lines={codeDiff.lines}
        cycle={0}
        className="rounded-lg"
        action={
          props.relativePath && !props.isError ? (
            <WorkspaceDiffAction relative={props.relativePath} />
          ) : undefined
        }
      />
      {props.isError ? (
        <ReadWriteOutput
          result={props.result}
          outputText={props.outputText}
          language="markdown"
          isError
        />
      ) : null}
    </>
  )
}

function ReadWriteToolCard(
  props: ToolCallMessagePartProps & {
    variant: 'read' | 'write' | 'search'
    outputText: string
  }
) {
  const { rootPath } = useActiveWorkspace()
  const state = mapToolCallState(props)
  const label = toAgentToolLabel(props.toolName)
  const summary = summarize(props.args)
  const writePath = props.variant === 'write' ? findWritePath(props.args) : null
  const relativePath = useMemo(
    function () {
      if (!writePath) return null
      return normalizeToolPath(writePath, rootPath)
    },
    [writePath, rootPath]
  )
  // 标题 +/- 与展开 CodeDiff 共用一次 LCS，避免同卡双算
  const toolArgs = props.args as unknown
  const codeDiff = useMemo(
    function (): WriteCodeDiff | null {
      if (props.variant !== 'write') return null
      return parseWriteCodeDiff(toolArgs)
    },
    [props.variant, toolArgs]
  )
  const diffStat: WriteDiffStat | null = codeDiff
    ? { added: codeDiff.additions, removed: codeDiff.deletions }
    : null
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
        {props.variant === 'write' ? (
          <WriteCodeDiffBody
            args={toolArgs}
            codeDiff={codeDiff}
            writePath={writePath}
            relativePath={relativePath}
            result={props.result}
            outputText={props.outputText}
            isError={props.isError === true}
          />
        ) : (
          <>
            <ToolInput input={toolArgs} />
            <ReadWriteOutput
              result={props.result}
              outputText={props.outputText}
              language={language}
              isError={props.isError === true}
            />
          </>
        )}
      </ToolContent>
    </Tool>
  )
}

export { ReadWriteToolCard }
