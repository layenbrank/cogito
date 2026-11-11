/**
 * 命令类工具卡的「任务进度」形态（assistant-ui `elements/job-progress`）。
 *
 * 什么时候走到这里由 `tool-card-job-state.ts` 决定：后台命令，或前台已跑 ≥ 20s。
 * 这时候用户真正想知道的是「跑到哪了、还要多久、最后成没成」，而不是一段正在滚动的终端。
 *
 * 卡片口径（与元素页一致）：
 * - 抬头 = 命令本身 + 运行中的 ETA / 收据态的耗时；
 * - 一条加权进度条（命令只有一个阶段，weight = 1）；
 * - 阶段标签下面挂当前阶段的说明，这里放工作目录 —— 同一条命令在不同 cwd 下意义完全不同；
 * - 不提供取消按钮：ACP 没有「取消单个工具调用」的接口，给个按不动的按钮比不给更糟；
 * - 原始输出不丢，折在下面那条「输出」里，点开仍是终端。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { JobProgress } from '@cogito/design/assistant/job-progress'
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import {
  Terminal,
  TerminalContent,
  TerminalCopyButton
} from '@cogito/design/assistant/terminal'
import { Button } from '@cogito/design/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { clsx } from 'clsx'
import { useMemo, useState } from 'react'

import {
  findCommandOutcome,
  findCommandStageIndex
} from '@/views/agent/chat/components/tool-card-job-state'
import type { toShellCommand } from '@/views/agent/chat/components/tool-output'

type CommandShell = NonNullable<ReturnType<typeof toShellCommand>>

type ToolCardJobProps = ToolCallMessagePartProps & {
  outputText: string
  /** 已跑时长（`useToolCallElapsed()`）；运行中可能还没有 */
  elapsedMs?: number
  /** 已解析好的命令（分发器那边算过一次，不重复解析） */
  shell: CommandShell
  /** 命令跑在右栏嵌入式终端里（输出以那边为准） */
  embedded?: boolean
}

function ToolCardJob(props: ToolCardJobProps) {
  const labels = useAssistantLabels()
  const isRunning = props.status?.type === 'running'
  const [isOpen, setOpen] = useState(false)

  // 命令只有一个阶段：weight 取 1，整条进度条按「运行中 / 走完」推进
  const stages = useMemo(
    function buildCommandStages() {
      return [
        {
          name: labels.jobStageCommand,
          weight: 1,
          description: props.shell.workdir ?? undefined
        }
      ]
    },
    [labels.jobStageCommand, props.shell.workdir]
  )

  const terminalBody = `$ ${props.shell.command}\n${props.outputText}`

  return (
    <div
      data-slot="tool-card-job"
      className="my-1 flex w-full flex-col gap-1.5">
      <JobProgress
        title={props.shell.command}
        stages={stages}
        stageIndex={findCommandStageIndex(isRunning)}
        stageProgress={0}
        eta={isRunning ? labels.jobRunning : ''}
        outcome={findCommandOutcome({
          isRunning,
          isError: Boolean(props.isError)
        })}
        elapsedMs={props.elapsedMs}
        className="max-w-none"
      />

      <Collapsible
        open={isOpen}
        onOpenChange={setOpen}
        className="border-border/60 bg-terminal overflow-hidden rounded-md border">
        <div className="flex items-center gap-1 pe-1">
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="aria-expanded:bg-transparent hover:bg-transparent h-6 min-w-0 flex-1 justify-start gap-1.5 px-2 font-normal"
              />
            }>
            <Icon
              icon="lucide:chevron-right"
              className={clsx(
                'text-terminal-muted size-3 shrink-0 transition-transform duration-200',
                isOpen && 'rotate-90'
              )}
            />
            <span className="text-terminal-muted min-w-0 truncate text-xs">
              {labels.jobCommandOutput}
            </span>
          </CollapsibleTrigger>
          <TerminalCopyButton
            text={terminalBody}
            aria-label={labels.copy}
            title={labels.copy}
          />
        </div>

        <CollapsibleContent>
          {/*
           * 抬头（JobProgress 标题 + 这条「输出」行）已经写过命令：
           * 正文用 `showPrompt={false}`，只排输出 —— 否则同一条命令在同一张卡里出现两次。
           */}
          <Terminal
            output={props.outputText || (isRunning ? '执行中…' : '无输出')}
            isStreaming={isRunning}
            cwd={props.shell.workdir}
            showPrompt={false}
            showHeader={false}
            className="border-terminal-border/70 rounded-none border-x-0 border-b-0">
            <TerminalContent />
          </Terminal>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export { ToolCardJob }
export type { CommandShell, ToolCardJobProps }
