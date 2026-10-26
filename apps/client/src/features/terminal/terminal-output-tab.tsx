/**
 * 共享「输出」tab：订阅传入运行实例的进度帧，灌入只读 xterm。
 * 并发运行时由外层按标签选中实例，再逐个回放各自的帧。
 */
import { useCorexStore } from '@/stores/corex.ts'
import { useRunFrames } from '@/stores/run-logs.ts'

import { TerminalOutput } from './terminal-output'

interface TerminalOutputTabProps {
  active: boolean
  /** 要回显的运行实例；null 表示还没有任何运行 */
  runId: string | null
  placeholder?: string
}

function TerminalOutputTab(props: TerminalOutputTabProps) {
  const frames = useRunFrames(props.runId)
  const error = useCorexStore(function (state) {
    if (!props.runId) return null
    const run = state.runs.find(function (item) {
      return item.id === props.runId
    })
    return run?.error ?? null
  })

  return (
    <TerminalOutput
      active={props.active}
      runId={props.runId}
      frames={frames.frames}
      error={error}
      placeholder={props.placeholder ?? '运行指令后，stdout/stderr 将流式显示在这里…'}
    />
  )
}

export { TerminalOutputTab }
