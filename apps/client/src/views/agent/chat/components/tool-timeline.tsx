/**
 * Tool timeline 的 app 适配层：把一条助手消息里的工具调用映射成「步骤 + 文件改动」。
 *
 * 元素页的口径是**宿主负责映射**（库不猜工具名）：这里就是那份映射 ——
 * 动词走 `labels.timelineVerb`（工具名 → 读取 / 运行 / 修改 …），芯片取参数里
 * 最有信息量的那个字段（路径 / 命令 / 查询词），文件改动从写工具的 before/after 现算。
 *
 * 挂载位置说明：
 * 对话流一轮的过程已经**按块摊开**（思考一段一条、工具一件一行，各自开合），同一条消息里
 * 再挂一条紧凑清单就是重复。所以本组件默认**不挂在消息里**，留给「需要紧凑工具流水」的位置：
 * - 没有正文的长跑回合（纯工具）；
 * - 子面板 / 收件箱这类拿不到完整对话的窄栏。
 * 真要挂进消息，记得别和过程区的工具卡重复。
 */
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import { ToolTimeline, type ToolTimelineStep } from '@cogito/design/assistant/tool-timeline'
import { formatTimelineLabel, type TimelineStat } from '@cogito/design/assistant/tool-timeline-state'
import type { ToolCallMessagePart } from '@assistant-ui/react'
import { useMemo, useState } from 'react'

import {
  findBaseName
} from '@/views/agent/chat/components/parse-tool-result'
import { readWriteChurn } from '@/views/agent/chat/components/file-changes'

/** 工具名 → 图标。归类口径与 `labels.timelineVerb` 保持一致（一个动词一个图标） */
function findStepIcon(toolName: string): string {
  const name = toolName.toLowerCase()
  if (/(write|edit|patch|apply)/.test(name)) return 'lucide:pen-line'
  if (/(read|view|cat)/.test(name)) return 'lucide:file-search'
  if (/(run|shell|exec|command|terminal)/.test(name)) return 'lucide:terminal'
  if (/(search|grep|find|query)/.test(name)) return 'lucide:search'
  if (/(list|glob|tree)/.test(name)) return 'lucide:folder-tree'
  if (/(fetch|web|browse|http)/.test(name)) return 'lucide:globe'
  return 'lucide:wrench'
}

/** 芯片取参数里最能说明「动的是哪儿」的字段；都没有就不写芯片，不要拿 id 凑 */
function findStepChip(part: ToolCallMessagePart): string | undefined {
  const args = part.args as Record<string, unknown> | undefined
  if (!args) return undefined
  const candidate =
    args.path ?? args.file_path ?? args.file ?? args.command ?? args.pattern ?? args.query ?? args.url
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}

/** 写工具的 before/after → `+14 −3`；不是整文件写入（片段级）就没有统计 */
function toFileStat(part: ToolCallMessagePart): TimelineStat | null {
  const churn = readWriteChurn(part)
  if (!churn) return null
  return {
    file: findBaseName(churn.path),
    added: churn.additions,
    removed: churn.deletions
  }
}

interface AgentToolTimelineProps {
  /** 这条消息里的 part（只取其中的 tool-call） */
  parts: readonly { readonly type: string }[]
  /** 这一轮还在跑 */
  streaming: boolean
  className?: string
}

function AgentToolTimeline({ parts, streaming, className }: AgentToolTimelineProps) {
  const labels = useAssistantLabels()
  const [isOpen, updateOpen] = useState(false)

  const toolCalls = useMemo(
    function () {
      return parts.filter(function (part): part is ToolCallMessagePart {
        return part.type === 'tool-call'
      })
    },
    [parts]
  )

  const steps = useMemo(
    function () {
      return toolCalls.map(function (part): ToolTimelineStep {
        return {
          id: part.toolCallId,
          verb: labels.timelineVerb(part.toolName),
          chip: findStepChip(part),
          icon: findStepIcon(part.toolName)
        }
      })
    },
    [labels, toolCalls]
  )

  const stats = useMemo(
    function () {
      return toolCalls
        .map(toFileStat)
        .filter(function (stat): stat is TimelineStat {
          return stat !== null
        })
    },
    [toolCalls]
  )

  if (steps.length === 0) return null

  return (
    <ToolTimeline
      className={className}
      steps={steps}
      visibleSteps={steps.length}
      streaming={streaming}
      open={isOpen}
      onOpenChange={updateOpen}
      restingLabel={formatTimelineLabel(steps.length, stats.length, labels)}
      activeLabel={labels.timelineWorking}
      stats={stats}
    />
  )
}

export { AgentToolTimeline }
