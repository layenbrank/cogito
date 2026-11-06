/**
 * 命令类工具卡：按「这件事要花多久」分两种形态。
 *
 * - **普通前台命令**（几秒就完）→ 一行 `$ 命令` + 状态 + 耗时，点开才是终端正文；
 * - **长任务**（后台命令，或前台已跑 ≥ 20s）→ `ToolCardJob`，assistant-ui
 *   `elements/job-progress` 那张卡：抬头给状态 / 耗时，一条进度条，原始输出折在下面。
 *
 * 判定在 `tool-card-job-state.ts`（纯函数，有单测），这里只做分发。
 * 展开态 pin 住 —— 运行中也不自动弹开，否则一次 run 里几条命令会把消息顶走。
 *
 * 折叠行高度与 `ToolFallback.Trigger` / `CodeDiff` 标题栏同一口径：
 * `TOOL_ROW_HEIGHT_CLASS`（28px）。一次回答里命令卡、文件卡、通用卡常常连着出现，
 * 行高差 4px 就会看起来像排版坏了。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { useToolCallElapsed } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Terminal, TerminalContent, TerminalCopyButton } from '@cogito/design/assistant/terminal'
import { ToolElapsed } from '@cogito/design/assistant/tool'
import { TOOL_ROW_HEIGHT_CLASS } from '@cogito/design/assistant/tool-row'
import { Button } from '@cogito/design/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { clsx } from 'clsx'
import { useState } from 'react'

import { ToolCardJob } from '@/views/agent/chat/components/tool-card-job'
import { isJobCommand } from '@/views/agent/chat/components/tool-card-job-state'
import { toShellCommand } from '@/views/agent/chat/components/tool-output'
import type { CommandShell } from '@/views/agent/chat/components/tool-card-job'

type CommandProps = ToolCallMessagePartProps & { outputText: string }

/** 短命令 / 普通命令：折叠成一条「终端条」 */
function ToolCardCommandRow(props: CommandProps & { shell: CommandShell }) {
  const isRunning = props.status?.type === 'running'
  const shell = props.shell
  // 折叠态就一行「$ 命令」：默认不挂终端正文，点开才渲染、并 pin 住
  const [isOpen, setOpen] = useState(false)
  // 出错自动展开一次：失败的终端输出往往就是答案；之后用户可以自行收起
  const [wasError, setWasError] = useState(Boolean(props.isError))
  if (Boolean(props.isError) !== wasError) {
    setWasError(Boolean(props.isError))
    if (props.isError) setOpen(true)
  }

  const emptyHint = isRunning ? '执行中…' : props.isError ? '没有任何输出' : '无输出'
  const terminalBody = `$ ${shell.command}\n${props.outputText || emptyHint}`

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setOpen}
      // 折叠态就是一条「终端条」：底色用实色 terminal，浅色主题下也保持终端观感
      className="border-terminal-border/70 bg-terminal my-1 overflow-hidden rounded-md border">
      <div className="flex items-center gap-1 pe-1">
        <CollapsibleTrigger
          data-slot="tool-card-command-trigger"
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={clsx(
                TOOL_ROW_HEIGHT_CLASS,
                'aria-expanded:bg-transparent hover:bg-transparent min-w-0 flex-1 justify-start gap-1.5 px-2 font-normal'
              )}
            />
          }>
          <Icon
            icon="lucide:chevron-right"
            className={clsx(
              'text-terminal-muted size-3 shrink-0 transition-transform duration-200',
              isOpen && 'rotate-90'
            )}
          />
          <Icon
            icon="lucide:terminal"
            className="text-terminal-accent size-3 shrink-0"
          />
          <span className="text-terminal-foreground min-w-0 truncate font-mono text-xs">
            {shell.command}
          </span>
          {shell.background ? (
            <span className="text-terminal-muted shrink-0 text-xs">后台</span>
          ) : null}
        </CollapsibleTrigger>

        {isRunning ? (
          <Icon
            icon="lucide:loader-circle"
            aria-label="执行中"
            className="text-terminal-accent size-3 shrink-0 animate-spin"
          />
        ) : (
          <Icon
            icon={props.isError ? 'lucide:x' : 'lucide:check'}
            aria-label={props.isError ? '执行失败' : '执行完成'}
            className={clsx(
              'size-3 shrink-0',
              props.isError ? 'text-terminal-danger' : 'text-terminal-accent'
            )}
          />
        )}
        <ToolElapsed />
        <TerminalCopyButton
          text={terminalBody}
          aria-label="复制命令与输出"
          title="复制命令与输出"
        />
      </div>

      <CollapsibleContent>
        <Terminal
          output={terminalBody}
          isStreaming={isRunning}
          cwd={shell.workdir}
          showHeader={false}
          className="border-terminal-border/70 rounded-none border-x-0 border-b-0">
          <TerminalContent />
        </Terminal>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolCardTerminalBody(props: CommandProps) {
  const shell = toShellCommand(props.args)
  // 耗时必须在早退之前取，`useToolCallElapsed` 是 hook
  const elapsedMs = useToolCallElapsed()

  if (!shell) return null

  // 后台命令不知道什么时候结束，跑久了的前台命令用户开始关心进度 —— 都交给任务卡
  if (isJobCommand(shell.background, elapsedMs)) {
    return (
      <ToolCardJob
        {...props}
        shell={shell}
        elapsedMs={elapsedMs}
      />
    )
  }

  return (
    <ToolCardCommandRow
      {...props}
      shell={shell}
    />
  )
}

export { ToolCardCommandRow, ToolCardTerminalBody }
