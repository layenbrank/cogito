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

import { chatModelPort } from '@/features/chat/port/instance.ts'
import { toAgentToolLabel } from '@/shared/agent-tools'
import { toCodeSource, toShellCommand } from './tool-output.ts'
import { ToolCodeMode, ToolCommand } from './tool-terminal.tsx'

/**
 * 工具卡：一行摘要 + 展开详情 + 待审批时的放行/拒绝。
 *
 * 形态按工具名分派（对象映射，不写 if 链）：
 * - `shell` / `execute` 走**模拟终端**（见 tool-terminal.tsx）—— 它们是「跑东西」，输出是日志；
 * - 其余工具走通用卡：参数与结果各一个 `<pre>`，因为内容本来就是结构化的文件/查询结果。
 *
 * 审批按钮直接打回主进程（`chatModelPort.respondToApproval`）——
 * opencode 此刻正卡在权限询问上等这个回执，回执一到它才真的执行工具。
 */

type ToolCardVariant = 'command' | 'code' | 'generic'

/** 工具名 → 卡片形态。表里没有的一律通用卡（opencode 升级新增工具时不会渲染成空白） */
const TOOL_VARIANTS: Readonly<Record<string, ToolCardVariant>> = {
  shell: 'command',
  execute: 'code'
}

/** 各形态的外壳：终端卡自带深色边框，不必再套一层通用边框 */
const FRAME_CLASSES: Readonly<Record<ToolCardVariant, string>> = {
  command: '',
  code: '',
  generic: 'bg-background border'
}

/** 摘要行：把参数里最有信息量的那一项摆出来（opencode 各工具用不同的键） */
const SUMMARY_KEYS = [
  'filePath',
  'path',
  'command',
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

/**
 * 详情渲染：参数是结构化对象，结果多半是一段文本（opencode v2 的工具结果就是文本），
 * 所以字符串原样展示 —— 否则整段文本会被 JSON 转义成一坨 `\n`。
 */
function formatDetail(value: unknown): string {
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    console.warn('[agent] 工具内容不可序列化，回退 String()', error)
    return String(value)
  }
}

/** 还没出结果时返回 null，终端面板据此显示「执行中…」而不是一片空白 */
function toOutput(result: unknown): string | null {
  return result === undefined ? null : formatDetail(result)
}

/** 待审批：放行 / 拒绝。终端卡与通用卡共用同一条 */
function ApprovalBar(props: Pick<ToolCallMessagePartProps, 'approval' | 'toolCallId'>) {
  const approval = props.approval
  if (!approval || approval.approved !== undefined) return null

  function handleApprove(approved: boolean) {
    // 只有还在等回执的那次审批才算数：运行早已结束/工具已跑完时如实报错，
    // 否则用户看到「已放行」而工具根本没动
    const delivered = chatModelPort.respondToApproval?.({ toolCallId: props.toolCallId, approved })
    if (delivered) {
      toast.success(approved ? '已放行' : '已拒绝', { duration: 1000 })
      return
    }
    toast.error('这次审批已经失效，请重新发送', { duration: 2000 })
  }

  return (
    <div className="bg-muted flex items-center gap-2 border-t px-2.5 py-2">
      <Icon icon="lucide:shield-alert" className="text-primary size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-xs">
        {approval.prompt ?? '需要你确认后才会执行'}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={function () {
          handleApprove(false)
        }}>
        <Icon icon="lucide:x" />
        拒绝
      </Button>
      <Button
        type="button"
        size="sm"
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

/** 通用卡：摘要行（可点开）+ 参数 / 结果 */
function GenericToolCard(props: GenericToolCardProps) {
  const [isOpen, updateOpen] = useState(false)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={updateOpen}>
      <CollapsibleTrigger
        className="text-foreground hover:bg-muted flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-start text-xs"
        aria-label={`${toAgentToolLabel(props.toolName)} 详情`}>
        <Icon icon="lucide:chevron-right"
          data-open={isOpen ? 'true' : 'false'}
          className="text-muted-foreground size-3 shrink-0 transition-transform data-[open=true]:rotate-90" />
        <Icon icon="lucide:terminal" className="text-muted-foreground size-3.5 shrink-0" />
        <span className="shrink-0 font-medium">{toAgentToolLabel(props.toolName)}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {summarize(props.args)}
        </span>
        {props.isRunning ? (
          <Icon icon="lucide:loader-circle" className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
        ) : null}
        {props.needsApproval ? (
          <Badge
            variant="secondary"
            className="h-4.5 shrink-0 px-1.5 text-xs">
            待审批
          </Badge>
        ) : null}
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-2 px-2.5 pb-2.5">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">参数</span>
          <pre className="bg-muted m-0 max-h-65 overflow-auto rounded-md p-2 font-mono text-xs leading-normal break-all whitespace-pre-wrap">
            {formatDetail(props.args)}
          </pre>
        </div>
        {props.result === undefined ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              {props.isError ? '错误' : '结果'}
            </span>
            <pre className="bg-muted m-0 max-h-65 overflow-auto rounded-md p-2 font-mono text-xs leading-normal break-all whitespace-pre-wrap">
              {formatDetail(props.result)}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function AgentToolCard(props: ToolCallMessagePartProps) {
  const approval = props.approval
  const needsApproval = Boolean(approval) && approval?.approved === undefined
  const isRunning = props.status?.type === 'running'
  const isDone = props.status?.type === 'complete'
  const variant = TOOL_VARIANTS[props.toolName] ?? 'generic'
  const shell = variant === 'command' ? toShellCommand(props.args) : null
  const code = variant === 'code' ? toCodeSource(props.args) : null
  const output = toOutput(props.result)

  return (
    <div
      data-state={needsApproval ? 'approval' : isRunning ? 'running' : isDone ? 'done' : 'error'}
      className={`my-2 flex flex-col gap-1.5 overflow-hidden rounded-lg data-[state=approval]:ring-primary data-[state=approval]:ring-1 ${FRAME_CLASSES[variant]}`}>
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
