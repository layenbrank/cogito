/**
 * 工具卡：对齐 studio —— 命令走模拟终端，其余通用折叠；审批回执走 chatModelPort。
 */
import { Icon } from '@iconify/react/offline'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { useState } from 'react'
import { toast } from 'sonner'

import { chatModelPort } from '@/features/agent/port/instance'
import { isCodeTool, isShellTool, toAgentToolLabel } from '@/features/agent/tool-labels'
import { formatTerminalText, toCodeSource, toShellCommand } from './tool-output'
import { ToolCodeMode, ToolCommand } from './tool-terminal'

type ToolCardVariant = 'command' | 'code' | 'generic'

/** 扁平：仅待审批时留 ring；终端自带深色框，通用卡不再套边框卡片 */
const FRAME_CLASSES: Readonly<Record<ToolCardVariant, string>> = {
  command: '',
  code: '',
  generic: ''
}

const SUMMARY_KEYS = [
  'filePath',
  'path',
  'command',
  'cmd',
  'pattern',
  'url',
  'query',
  'description',
  'prompt'
]

function summarize(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const record = args as Record<string, unknown>
  for (const key of SUMMARY_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function formatDetail(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    console.warn('[agent] 工具内容不可序列化，回退 String()', error)
    return String(value)
  }
}

function toOutput(result: unknown): string | null {
  // 终端正文走 formatTerminalText：抽出 stdout/content，并解开字面 `\n` / 二次 JSON 编码
  return result === undefined ? null : formatTerminalText(result)
}

function findVariant(toolName: string): ToolCardVariant {
  if (isShellTool(toolName)) return 'command'
  if (isCodeTool(toolName)) return 'code'
  return 'generic'
}

function ApprovalBar(props: Pick<ToolCallMessagePartProps, 'approval' | 'toolCallId'>) {
  const approval = props.approval
  if (!approval || approval.approved !== undefined) return null

  function handleApprove(approved: boolean) {
    const delivered = chatModelPort.respondToApproval?.({
      toolCallId: props.toolCallId,
      approved
    })
    if (delivered) {
      toast.success(approved ? '已放行' : '已拒绝', { duration: 1000 })
      return
    }
    toast.error('这次审批已经失效，请重新发送', { duration: 2000 })
  }

  return (
    <div className="border-border bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2">
      <Icon
        icon="lucide:shield-alert"
        className="text-muted-foreground size-3.5 shrink-0"
      />
      <span className="text-foreground min-w-0 flex-1 truncate text-xs">
        {approval.prompt ?? '需要你确认后才会执行'}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 rounded-md"
        onClick={function () {
          handleApprove(false)
        }}>
        <Icon icon="lucide:x" />
        拒绝
      </Button>
      <Button
        type="button"
        size="sm"
        className="h-7 rounded-md"
        onClick={function () {
          handleApprove(true)
        }}>
        <Icon icon="lucide:check" />
        放行
      </Button>
    </div>
  )
}

interface GenericToolCardProps extends ToolCallMessagePartProps {
  isRunning: boolean
  needsApproval: boolean
}

function GenericToolCard(props: GenericToolCardProps) {
  const [isOpen, updateOpen] = useState(props.needsApproval || props.isRunning)
  const summary = summarize(props.args)
  const label = toAgentToolLabel(props.toolName)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={updateOpen}
      className="group/tool not-prose my-1 w-full overflow-hidden rounded-md border">
      <CollapsibleTrigger
        className="text-foreground hover:text-foreground flex w-full cursor-pointer items-center justify-between gap-4 p-3 text-start"
        aria-label={`${label} 详情`}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icon
            icon={
              isShellTool(props.toolName)
                ? 'lucide:terminal'
                : isCodeTool(props.toolName)
                  ? 'lucide:braces'
                  : 'lucide:wrench'
            }
            className="text-muted-foreground size-4 shrink-0"
          />
          <span className="shrink-0 text-sm font-medium">{label}</span>
          {summary ? (
            <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
              {summary}
            </span>
          ) : null}
          {props.isRunning ? (
            <Icon
              icon="lucide:loader-circle"
              className="text-muted-foreground size-3.5 shrink-0 animate-spin"
            />
          ) : null}
          {props.needsApproval ? (
            <Badge
              variant="secondary"
              className="h-4.5 gap-1.5 rounded-full px-1.5 text-xs">
              待审批
            </Badge>
          ) : null}
        </div>
        <Icon
          icon="lucide:chevron-down"
          data-open={isOpen ? 'true' : 'false'}
          className="text-muted-foreground size-4 shrink-0 transition-transform data-[open=true]:rotate-180"
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-4 space-y-0 p-4 pt-0">
        <div className="flex flex-col gap-2 overflow-hidden">
          <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            参数
          </h4>
          <pre className="bg-muted/50 m-0 max-h-72 overflow-auto overscroll-y-contain rounded-md p-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
            {formatDetail(props.args)}
          </pre>
        </div>
        {props.result === undefined ? null : (
          <div className="flex flex-col gap-2 overflow-hidden">
            <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {props.isError ? '错误' : '结果'}
            </h4>
            <pre
              className={[
                'm-0 max-h-80 overflow-auto overscroll-y-contain rounded-md p-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap',
                props.isError ? 'bg-destructive/10 text-destructive' : 'bg-muted/50'
              ].join(' ')}>
              {formatTerminalText(props.result)}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function AgentToolCard(props: ToolCallMessagePartProps) {
  const approval = props.approval
  const needsApproval = Boolean(approval) && approval?.approved === undefined
  const isRunning = props.status?.type === 'running'
  const isDone = props.status?.type === 'complete'
  const variant = findVariant(props.toolName)
  const shell = variant === 'command' ? toShellCommand(props.args) : null
  const code = variant === 'code' ? toCodeSource(props.args) : null
  const output = toOutput(props.result)

  return (
    <div
      data-slot="agent-tool-card"
      data-state={needsApproval ? 'approval' : isRunning ? 'running' : isDone ? 'done' : 'error'}
      className={`my-1 flex flex-col gap-1.5 overflow-hidden ${FRAME_CLASSES[variant]}`}>
      {shell ? (
        <ToolCommand
          command={shell.command}
          workdir={shell.workdir}
          background={shell.background}
          output={output}
          isError={Boolean(props.isError)}
          isRunning={isRunning}
        />
      ) : code ? (
        <ToolCodeMode
          source={code}
          output={output}
          isError={Boolean(props.isError)}
          isRunning={isRunning}
        />
      ) : (
        <GenericToolCard
          {...props}
          isRunning={isRunning}
          needsApproval={needsApproval}
        />
      )}

      <ApprovalBar
        approval={props.approval}
        toolCallId={props.toolCallId}
      />
    </div>
  )
}

export { AgentToolCard }
