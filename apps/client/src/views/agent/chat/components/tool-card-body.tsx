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
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CodeBlock } from '@cogito/design/assistant/code-block'
import { FileTree, FileTreeFile, FileTreeFolder } from '@cogito/design/assistant/file-tree'
import { ToolFallback } from '@cogito/design/assistant/tool-fallback.aui'
import { Button } from '@cogito/design/components/button'

import { toolCallSummary } from '@/features/agent/tool-call-summary'
import { findHardDenyReplacement, isPolicyDeniedText } from '@/features/agent/approval'
import {
  buildToolFailureReport,
  classifyToolFailure,
  describeToolFailure
} from '@/features/agent/failure-source'
import {
  findBrowserToolLabel,
  isBrowserTool,
  toAgentToolLabel
} from '@/features/agent/tool-labels'
import { mapToolCallState } from '@/views/agent/chat/components/parse-tool-result'
import { openAsideBrowser } from '@/views/agent/chat/components/open-aside-browser'
import type { ParsedFileTreeNode, ParsedToolCard } from '@/views/agent/chat/components/parse-tool-result'
import { WriteToolCard } from '@/views/agent/chat/components/tool-card-read-write'
import { ToolCardRetrieval } from '@/views/agent/chat/components/tool-card-retrieval'
import { ToolCardTimeline } from '@/views/agent/chat/components/tool-card-timeline'
import { ToolCardTerminalBody } from '@/views/agent/chat/components/tool-card-terminal-body'
import { ToolCardWebSearch } from '@/views/agent/chat/components/tool-card-web-search'
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
  /**
   * goose 把「策略拒绝」和「用户点了拒绝」压成同一句文案（`DECLINED_RESPONSE`），
   * 模型只能猜到后者 —— 实测过一次对话里 agent 反复追问「你是不是点了拒绝」，
   * 排查方向完全跑偏。这里把两种情形重新分开说明。
   */
  const policyDenied = Boolean(props.isError) && isPolicyDeniedText(outputText)
  const replacement = policyDenied ? findHardDenyReplacement(props.toolName) : null

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
        {policyDenied ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed">
            {replacement ? (
              <>
                这个工具在设计上就是禁用的（黑盒终端 / goose 原厂写工具会绕开 cogito 的终端与工作区写闸门），
                与审批档无关。请改用{' '}
                <code className="font-mono">{replacement}</code>。
              </>
            ) : (
              <>
                这次调用被授权策略拒绝，原因记录在权限文件里（不是当前这一轮点了拒绝）。到
                「设置 → 工具权限 → 手动偏好」看是哪条「从不允许」命中，必要时重置。
              </>
            )}
          </div>
        ) : null}
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

/**
 * 失败来源提示条：把「工具失败」拆成「谁的问题 + 下一步」。
 *
 * 为什么不做成另一种卡片：这一行的用途是**给人读的诊断**，不是结果本身；
 * 摆成第三个展开区只会把真正要看的错误原文挤下去。
 *
 * 「复制诊断」把工具名、`toolCallId`、归类、原始输出与参数一起带走 ——
 * `toolCallId` 就是日志里 `Select-String` 能对上的那一条。
 */
function ToolFailureNote(props: {
  toolName: string
  toolCallId: string
  output: string
  args: unknown
}) {
  const source = classifyToolFailure(props.output)
  const copy = describeToolFailure(source)

  function onCopy(): void {
    const report = buildToolFailureReport({
      toolName: props.toolName,
      toolCallId: props.toolCallId,
      output: props.output,
      args: props.args
    })
    void navigator.clipboard.writeText(report).then(
      function () {
        toast.success('已复制诊断信息')
      },
      function (error: unknown) {
        console.warn('[agent] 复制诊断信息失败', error)
        toast.error('复制失败：可展开卡片手动选取')
      }
    )
  }

  return (
    <div
      data-slot="agent-tool-failure"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">失败来源：{copy.label}</span>
      <span className="min-w-0">{copy.hint}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="ml-auto h-5 gap-1 px-1.5 font-normal"
        title="复制工具名、调用 id、原始输出与参数"
        onClick={onCopy}>
        <Icon
          icon="lucide:copy"
          className="size-3"
        />
        复制诊断
      </Button>
    </div>
  )
}

function ToolCardShellBody(props: ToolCallMessagePartProps & { parsed: ParsedToolCard }) {
  const { variant } = props.parsed
  const label = toAgentToolLabel(props.toolName)
  // 策略拒绝在通用行里已经单独解释过（还带替代工具），不再叠一条失败来源
  const policyDenied = Boolean(props.isError) && isPolicyDeniedText(props.parsed.text)

  function renderBody(): ReactNode {
    // 策略拒绝既不是「写成功」也不是「命令跑完」：一律走通用行，由它把原因说清楚
    if (policyDenied) {
      return (
        <ToolCardFallbackBody
          {...props}
          label={label}
        />
      )
    }
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
    // 联网检索：结果是一组来源而不是一段正文，交给 web-search 那张列表卡。
    // 失败 / 取消不套列表（要读的是错误原文），继续往通用行走。
    if (variant === 'web' && !props.isError) {
      return (
        <ToolCardWebSearch
          {...props}
          outputText={props.parsed.text}
        />
      )
    }
    // 库内检索：命中是一组段落，交给 retrieval-chunks 那张卡
    if (variant === 'retrieval' && !props.isError) {
      return (
        <ToolCardRetrieval
          {...props}
          outputText={props.parsed.text}
        />
      )
    }
    // 日历：结果是一组带时刻的事件，交给 timeline 那张竖轴卡
    if (variant === 'timeline' && !props.isError) {
      return (
        <ToolCardTimeline
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

  return (
    <>
      {renderBody()}
      {props.isError && !policyDenied ? (
        <ToolFailureNote
          toolName={props.toolName}
          toolCallId={props.toolCallId}
          output={props.parsed.text}
          args={props.args as unknown}
        />
      ) : null}
    </>
  )
}

export { ToolCardShellBody }
