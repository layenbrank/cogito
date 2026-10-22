/**
 * 共享「运行」输出 tab：订阅当前 focus 运行的进度帧，灌入只读 xterm。
 */
import { useMemo } from 'react'

import { useCorexStore } from '@/stores/corex.ts'
import { useRunFrames } from '@/stores/run-logs.ts'

import { TerminalOutput } from './terminal-output'

interface TerminalOutputTabProps {
  active: boolean
}

function TerminalOutputTab(props: TerminalOutputTabProps) {
  const focusRunId = useCorexStore(function (state) {
    return state.focusRunId
  })
  const runs = useCorexStore(function (state) {
    return state.runs
  })
  const frames = useRunFrames(focusRunId)

  const activeRun = useMemo(
    function () {
      if (!focusRunId) return null
      return (
        runs.find(function (run) {
          return run.id === focusRunId
        }) ?? null
      )
    },
    [runs, focusRunId]
  )

  return (
    <TerminalOutput
      active={props.active}
      runId={focusRunId}
      frames={frames.frames}
      error={activeRun?.error ?? null}
      placeholder="运行指令后，stdout/stderr 将流式显示在这里…"
    />
  )
}

export { TerminalOutputTab }
