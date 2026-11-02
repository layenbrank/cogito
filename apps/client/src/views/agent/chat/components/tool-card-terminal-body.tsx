/**
 * 命令类工具卡（对齐 VS Code 的终端块）：
 *
 * - **默认折叠**成一行 `$ 命令` + 状态 + 耗时，只回答「现在在跑什么」，不再每张卡撑一块终端；
 * - 点这一行才展开终端正文（ANSI 高亮、自动滚动、复制），展开后 pin 住 —— 运行中也不自动弹开。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Terminal, TerminalContent, TerminalCopyButton } from '@cogito/design/assistant/terminal'
import { ToolElapsed } from '@cogito/design/assistant/tool'
import { Button } from '@cogito/design/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { clsx } from 'clsx'
import { useState } from 'react'

import { toShellCommand } from '@/views/agent/chat/components/tool-output'

function ToolCardTerminalBody(props: ToolCallMessagePartProps & { outputText: string }) {
  const isRunning = props.status?.type === 'running'
  const shell = toShellCommand(props.args)
  // 手动展开即记住：本轮结束后保持展开（与 process-group 的 pinned 语义一致）
  const [isPinnedOpen, setPinnedOpen] = useState(false)

  if (!shell) return null

  const emptyHint = isRunning ? '执行中…' : props.isError ? '没有任何输出' : '无输出'
  const terminalBody = `$ ${shell.command}\n${props.outputText || emptyHint}`

  return (
    <Collapsible
      open={isPinnedOpen}
      onOpenChange={setPinnedOpen}
      // 折叠态就是一条「终端条」：底色用实色 terminal，浅色主题下也保持终端观感
      className="border-terminal-border/70 bg-terminal my-1 overflow-hidden rounded-md border">
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
              isPinnedOpen && 'rotate-90'
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

export { ToolCardTerminalBody }
