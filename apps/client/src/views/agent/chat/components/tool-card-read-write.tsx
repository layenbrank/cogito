/**
 * 写文件工具卡：只保留 `CodeDiff` 这一种形态。
 *
 * 头就是 CodeDiff 自己的标题栏 —— 文件名 + `+N −M` + 右侧「工作区」动作，一行说完；
 * 不再套 `Tool` / `ToolHeader` 那层「wrench 图标 + 中文状态徽章」的外壳，
 * 状态由工具行本身表达（运行中展开、结束后收起）。
 *
 * 拿不到 before/after（只有路径或纯覆盖写）时退回通用的 `ToolFallback` 明细，
 * 仍然是一行摘要 + 展开参数 / 结果。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react/offline'
import { CodeBlock } from '@cogito/design/assistant/code-block'
import { CodeDiff } from '@cogito/design/assistant/code-diff'
import { ToolFallback } from '@cogito/design/assistant/tool-fallback.aui'
import { Button } from '@cogito/design/components/button'

import { normalizeToolPath } from '@/features/agent/tool-paths'
import { toAgentToolLabel } from '@/features/agent/tool-labels'
import { useActiveWorkspace } from '@/features/agent/workspace/active'
import { openAsideReview } from '@/views/agent/chat/components/open-aside-review'
import {
  fetchWriteCodeDiff,
  findWritePath,
  parseWriteCodeDiff,
  type WriteCodeDiff
} from '@/views/agent/chat/components/parse-tool-result'

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

function WriteToolCard(props: ToolCallMessagePartProps & { outputText: string }) {
  const { rootPath } = useActiveWorkspace()
  const label = toAgentToolLabel(props.toolName)
  const writePath = findWritePath(props.args)
  const relativePath = useMemo(
    function () {
      if (!writePath) return null
      return normalizeToolPath(writePath, rootPath)
    },
    [writePath, rootPath]
  )
  // 同步首屏用本地 LCS，Tauri 下异步升级到 Rust lineDiff
  const toolArgs = props.args as unknown
  const [codeDiff, updateCodeDiff] = useState<WriteCodeDiff | null>(function () {
    return parseWriteCodeDiff(toolArgs)
  })
  useEffect(
    function () {
      updateCodeDiff(parseWriteCodeDiff(toolArgs))
      let cancelled = false
      void fetchWriteCodeDiff(toolArgs)
        .then(function (next) {
          if (!cancelled) updateCodeDiff(next)
        })
        .catch(function (error: unknown) {
          console.warn('[agent] fetchWriteCodeDiff 失败，保留同步 diff:', error)
        })
      return function () {
        cancelled = true
      }
    },
    [toolArgs]
  )

  if (!codeDiff) {
    return (
      <ToolFallback.Root className="my-1 mb-0">
        <ToolFallback.Trigger
          toolName={label}
          status={props.status}
          title={props.toolName}
        />
        <ToolFallback.Content>
          <ToolFallback.Error status={props.status} />
          <ToolFallback.Args argsText={props.argsText ?? JSON.stringify(props.args, null, 2)} />
          {props.outputText ? (
            <CodeBlock
              code={props.outputText}
              language="markdown"
              showHeader={false}
              contentClassName="max-h-[min(36vh,20rem)]"
            />
          ) : (
            <ToolFallback.Result result={props.result} />
          )}
          {relativePath && !props.isError ? (
            <div className="flex justify-end">
              <WorkspaceDiffAction relative={relativePath} />
            </div>
          ) : null}
        </ToolFallback.Content>
      </ToolFallback.Root>
    )
  }

  return (
    <div
      data-slot="agent-write-card"
      className="my-1 flex flex-col gap-1.5">
      <CodeDiff
        filename={codeDiff.filename}
        subtitle={relativePath ?? undefined}
        additions={codeDiff.additions}
        deletions={codeDiff.deletions}
        lines={codeDiff.lines}
        cycle={0}
        action={
          relativePath && !props.isError ? (
            <WorkspaceDiffAction relative={relativePath} />
          ) : undefined
        }
      />
      {props.isError ? (
        <div
          role="alert"
          className="text-destructive border-border/50 bg-muted/40 rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
          {props.outputText || '执行出错'}
        </div>
      ) : null}
    </div>
  )
}

export { WriteToolCard }
