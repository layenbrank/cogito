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
 *
 * **输出只排一次（2026-11 收口，对齐 assistant-ui `elements/terminal-block`）**：
 * 元素页把命令放在**抬头**（`cwd $ command`），正文只有输出行。这里照同一分工 ——
 * 折叠行写命令与 cwd，展开的终端正文用 `showPrompt={false}` 只排输出。
 * 旧做法在正文里又摆一遍 `$ 命令`，抬头一行、正文一行，读起来就是「同一条命令两个终端」。
 *
 * 跑在**右栏嵌入式终端**里的命令（`app terminal run`）不在这里再开一个终端：
 * 它的输出本来就落在用户看得见的那个终端里，卡片只做收据 + 跳过去看，
 * 否则同一段输出会在对话流和右栏各出现一次。
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

import { isEmbeddedTerminalTool } from '@/features/agent/tool-labels'
import { ToolCardJob } from '@/views/agent/chat/components/tool-card-job'
import { isJobCommand } from '@/views/agent/chat/components/tool-card-job-state'
import { toShellCommand } from '@/views/agent/chat/components/tool-output'
import type { CommandShell } from '@/views/agent/chat/components/tool-card-job'
import { openAsideTerminal } from '@/views/agent/chat/components/open-aside-terminal'

type CommandProps = ToolCallMessagePartProps & { outputText: string }

/** 抬头只留路径末两段：完整 workdir 塞进 title，长路径不挤掉命令本身 */
function toShortPath(workdir: string): string {
  const parts = workdir.trim().replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return parts.slice(-2).join('/')
}

/** 跳到右栏终端看这条命令的输出（对话流不再摆第二份） */
function TerminalJumpButton(props: { command: string; workdir: string | null; compact?: boolean }) {
  const onClick = function () {
    openAsideTerminal({ command: props.command, workdir: props.workdir })
  }
  if (props.compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-terminal-muted hover:bg-terminal/80 hover:text-terminal-foreground h-6 shrink-0 gap-1 px-1.5 text-xs font-normal"
        title="在右栏终端里查看输出"
        onClick={onClick}>
        <Icon
          icon="lucide:external-link"
          className="size-3"
        />
        查看
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-terminal-muted hover:bg-terminal/80 hover:text-terminal-foreground size-6 shrink-0"
      aria-label="在终端中查看"
      title="在终端中查看"
      onClick={onClick}>
      <Icon
        icon="lucide:external-link"
        className="size-3"
      />
    </Button>
  )
}

/** 短命令 / 普通命令：折叠成一条「终端条」 */
function ToolCardCommandRow(props: CommandProps & { shell: CommandShell; embedded: boolean }) {
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
  const hasOutput = props.outputText.trim().length > 0
  // 复制走完整回执（命令 + 输出）：抬头只有命令，复制出来仍要能直接贴给人看
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
          {shell.workdir ? (
            <span
              title={shell.workdir}
              className="text-terminal-muted/80 min-w-0 shrink-0 truncate text-[11px] tracking-tight">
              {toShortPath(shell.workdir)}
            </span>
          ) : null}
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
        {props.embedded ? (
          <TerminalJumpButton
            command={shell.command}
            workdir={shell.workdir}
          />
        ) : null}
        <TerminalCopyButton
          text={terminalBody}
          aria-label="复制命令与输出"
          title="复制命令与输出"
        />
      </div>

      <CollapsibleContent>
        {props.embedded ? (
          // 输出在右栏终端里：这里只交代「去哪儿看」，不再摆第二份终端
          <div
            data-slot="tool-card-terminal-hint"
            className="border-terminal-border/60 text-terminal-muted flex items-center gap-1.5 border-t px-2 py-1 text-xs">
            <Icon
              icon="lucide:terminal"
              className="size-3 shrink-0 opacity-70"
            />
            <span className="min-w-0 flex-1 truncate">
              {hasOutput ? '输出以右栏终端为准' : '输出在右栏终端里，不在这里重复'}
            </span>
            <TerminalJumpButton
              compact
              command={shell.command}
              workdir={shell.workdir}
            />
          </div>
        ) : (
          <Terminal
            output={props.outputText || emptyHint}
            isStreaming={isRunning}
            cwd={shell.workdir}
            // 抬头（折叠行）已经写过 `$ 命令` 与 cwd：正文只排输出，不复述
            showPrompt={false}
            showHeader={false}
            className="border-terminal-border/70 rounded-none border-x-0 border-b-0">
            <TerminalContent />
          </Terminal>
        )}
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
        embedded={isEmbeddedTerminalTool(props.toolName)}
        elapsedMs={elapsedMs}
      />
    )
  }

  return (
    <ToolCardCommandRow
      {...props}
      shell={shell}
      embedded={isEmbeddedTerminalTool(props.toolName)}
    />
  )
}

export { ToolCardCommandRow, ToolCardTerminalBody }
