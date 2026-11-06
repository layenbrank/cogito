/**
 * 工具卡的唯一外壳：assistant-ui 的 `ToolFallback`（一行「状态色块 + 工具名 + 参数摘要 + 耗时」
 * + 展开明细）。
 *
 * 为什么不再「按输出文本猜卡型」：一次回答里 6–8 张带徽章的重卡片是对话区最大的噪音，
 * 而真正有信息量的只有三处 —— 写文件的 diff、命令的终端输出、目录列举的文件树。
 * 所以这里只保留三个分支：
 * - `write` → `WriteToolCard`：文件名 + `+N −M` + 右侧动作，一行；展开是 CodeDiff。
 * - `command` → `ToolCardTerminalBody`：`$ 命令` 一行；展开是终端正文。
 * - 目录列举 → 文件树挂在明细里（`parse-tool-result.ts` 只保留这一个专项）。
 * 其余工具一律「通用行 + 展开参数 / 结果」。
 *
 * 已下线（见 `parse-tool-result.ts` 头注）：commit / test / stack / package / env /
 * schema / snippet 七种「从输出文本猜出来」的重卡片。
 * 折叠口径：默认只留一行「工具名 + 状态 + 耗时」，参数与输出正文整棵不进布局；
 * 例外只有两处 —— 待审批强制展开（按钮得可见），出错自动展开一次（原因得看见）。
 *
 * 后续方向是按 tool 名注册 `makeAssistantToolUI` 渲染器，本轮不做。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { useState } from 'react'
import { CodeBlock } from '@cogito/design/assistant/code-block'
import { FileTree, FileTreeFile, FileTreeFolder } from '@cogito/design/assistant/file-tree'
import { ToolFallback } from '@cogito/design/assistant/tool-fallback.aui'
import { Button } from '@cogito/design/components/button'

import { toolCallSummary } from '@/features/agent/tool-call-summary'
import {
  findBrowserToolLabel,
  isBrowserTool,
  toAgentToolLabel
} from '@/features/agent/tool-labels'
import { mapToolCallState } from '@/views/agent/chat/components/parse-tool-result'
import { openAsideBrowser } from '@/views/agent/chat/components/open-aside-browser'
import type { ParsedFileTreeNode, ParsedToolCard } from '@/views/agent/chat/components/parse-tool-result'
import { WriteToolCard } from '@/views/agent/chat/components/tool-card-read-write'
import { ToolCardTerminalBody } from '@/views/agent/chat/components/tool-card-terminal-body'
import { toShellCommand } from '@/views/agent/chat/components/tool-output'

/** 目录列举的文件树：只在明细里出现，不再是一张独立卡片 */
function ToolCardTree(props: { nodes: readonly ParsedFileTreeNode[] }) {
  return (
    <FileTree className="my-0">
      {props.nodes.map(function (node) {
        if (node.isDirectory) {
          return (
            <FileTreeFolder
              key={node.path}
              path={node.path}
              name={node.path}>
              {null}
            </FileTreeFolder>
          )
        }
        return (
          <FileTreeFile
            key={node.path}
            path={node.path}
            name={node.path}
          />
        )
      })}
    </FileTree>
  )
}

function ToolCardFallbackBody(
  props: ToolCallMessagePartProps & { parsed: ParsedToolCard; label: string }
) {
  const state = mapToolCallState(props)
  // 默认折叠成一行「工具名 + 状态 + 耗时」：折叠时参数与输出正文整棵不挂载，
  // 一次回合几十张卡全展开是对话区最大的重绘源。要看明细再点这一行。
  const requiresAttention = state === 'approval-requested'
  const [isOpen, setOpen] = useState(false)
  // 出错自动展开一次（让人看见原因），之后允许自行收起
  const [wasError, setWasError] = useState(Boolean(props.isError))
  if (Boolean(props.isError) !== wasError) {
    setWasError(Boolean(props.isError))
    if (props.isError) setOpen(true)
  }
  // 待审批不能折叠：按钮藏在折叠里等于把流程卡死
  const open = requiresAttention || isOpen
  const browserLabel = isBrowserTool(props.toolName)
    ? findBrowserToolLabel(props.args, props.result)
    : null
  const outputText = props.parsed.text
  const tree = props.parsed.special?.kind === 'tree' ? props.parsed.special.data : null
  const argsText = props.argsText ?? JSON.stringify(props.args, null, 2)

  return (
    <ToolFallback.Root
      open={open}
      onOpenChange={function (next) {
        if (requiresAttention) return
        setOpen(next)
      }}
      className="my-1 mb-0">
      <ToolFallback.Trigger
        toolName={props.label}
        detail={toolCallSummary(props.args)}
        status={props.status}
        title={props.toolName}
        className="w-full"
      />
      <ToolFallback.Content>
        <ToolFallback.Error status={props.status} />
        {tree ? <ToolCardTree nodes={tree} /> : null}
        <ToolFallback.Args argsText={argsText} />
        {outputText ? (
          <CodeBlock
            code={outputText}
            language="markdown"
            showHeader={false}
            contentClassName="max-h-[min(36vh,20rem)]"
          />
        ) : (
          <ToolFallback.Result result={props.result} />
        )}
        {browserLabel ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 font-normal"
              title="在右栏打开该标签页"
              onClick={function () {
                openAsideBrowser(browserLabel)
              }}>
              <Icon
                icon="lucide:globe"
                className="size-3"
              />
              打开该标签页
            </Button>
          </div>
        ) : null}
      </ToolFallback.Content>
    </ToolFallback.Root>
  )
}

function ToolCardShellBody(props: ToolCallMessagePartProps & { parsed: ParsedToolCard }) {
  const { variant } = props.parsed
  const label = toAgentToolLabel(props.toolName)

  if (variant === 'write') {
    return (
      <WriteToolCard
        {...props}
        outputText={props.parsed.text}
      />
    )
  }
  if (variant === 'command' && toShellCommand(props.args)) {
    return (
      <ToolCardTerminalBody
        {...props}
        outputText={props.parsed.text}
      />
    )
  }
  return (
    <ToolCardFallbackBody
      {...props}
      label={label}
    />
  )
}

export { ToolCardShellBody }
