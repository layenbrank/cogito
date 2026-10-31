import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle
} from '@cogito/design/assistant/terminal'

import { toShellCommand } from '@/views/agent/chat/components/tool-output'

function ToolCardTerminalBody(
  props: ToolCallMessagePartProps & { outputText: string; label: string }
) {
  const isRunning = props.status?.type === 'running'
  const shell = toShellCommand(props.args)
  if (!shell) return null

  const titleBits = [props.label]
  if (shell.background) titleBits.push('后台')
  const emptyHint = isRunning ? '执行中…' : props.isError ? '没有任何输出' : '无输出'
  const terminalBody = `$ ${shell.command}\n${props.outputText || emptyHint}`

  return (
    <Terminal
      output={terminalBody}
      isStreaming={isRunning}
      cwd={shell.workdir}
      className="my-0">
      <TerminalHeader>
        <TerminalTitle>{titleBits.join(' · ')}</TerminalTitle>
        <div className="flex shrink-0 items-center gap-1">
          <TerminalStatus />
          {!isRunning ? (
            <Icon
              icon={props.isError ? 'lucide:x' : 'lucide:check'}
              className={
                props.isError
                  ? 'text-terminal-danger size-3 shrink-0'
                  : 'text-terminal-accent size-3 shrink-0'
              }
            />
          ) : null}
          <TerminalActions>
            <TerminalCopyButton />
          </TerminalActions>
        </div>
      </TerminalHeader>
      <TerminalContent />
    </Terminal>
  )
}

export { ToolCardTerminalBody }
