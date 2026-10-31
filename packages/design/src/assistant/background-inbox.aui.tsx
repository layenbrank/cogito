import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import type { FC } from 'react'

import { Button } from '../components/button'

/** 后台收件箱里的一行：运行中 / 已跑完待领取 / 失败 */
interface BackgroundRun {
  id: string
  title: string
  state: 'running' | 'ready' | 'failed'
  elapsed?: string
  summary?: string
}

interface BackgroundInboxProps {
  runs: readonly BackgroundRun[]
  /** 传了之后每行都可点（跳到该会话）；running 行用于「切过去看进度」，ready 行用于「领取结果」 */
  onOpen?: (id: string) => void
  className?: string
}

const STATE_ICON = {
  running: 'lucide:loader-2',
  ready: 'lucide:check',
  failed: 'lucide:x'
} as const

const STATE_ICON_CLASS = {
  running: 'text-muted-foreground animate-spin',
  ready: 'text-success',
  failed: 'text-destructive'
} as const

/**
 * 后台运行收件箱：一眼看到哪些会话还在别处跑、哪些已跑完待领取。
 * 纯展示，数据由调用方投影（运行态 / 完成态来自各 app 的端口层）。
 */
const BackgroundInbox: FC<BackgroundInboxProps> = function BackgroundInbox(props) {
  const readyCount = props.runs.reduce(function (n, run) {
    return run.state === 'ready' ? n + 1 : n
  }, 0)
  const runningCount = props.runs.reduce(function (n, run) {
    return run.state === 'running' ? n + 1 : n
  }, 0)
  const summary = readyCount > 0 ? `${readyCount} 已完成` : `${runningCount} 进行中`

  return (
    <div
      data-slot="aui_background-inbox"
      className={clsx('flex flex-col gap-0.5', props.className)}>
      <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-xs font-medium tracking-wide uppercase">
        <Icon
          icon="lucide:orbit"
          className="size-3 shrink-0 opacity-70"
        />
        后台运行
        <span className="ml-auto text-xs font-normal normal-case opacity-70">{summary}</span>
      </div>
      {props.runs.map(function (run) {
        return (
          <Button
            key={run.id}
            type="button"
            variant="ghost"
            disabled={!props.onOpen}
            onClick={props.onOpen ? function () { props.onOpen?.(run.id) } : undefined}
            className="hover:bg-muted/60 justify-start gap-2 rounded-md px-2 py-1.5 font-normal">
            <Icon
              icon={STATE_ICON[run.state]}
              className={clsx('size-3.5 shrink-0', STATE_ICON_CLASS[run.state])}
            />
            <span className="min-w-0 flex-1 truncate text-left text-sm">{run.title}</span>
            {run.summary ? (
              <span className="text-muted-foreground shrink-0 text-xs">{run.summary}</span>
            ) : null}
            {run.elapsed ? (
              <span className="text-muted-foreground shrink-0 text-xs">{run.elapsed}</span>
            ) : null}
          </Button>
        )
      })}
    </div>
  )
}

export { BackgroundInbox }
export type { BackgroundInboxProps, BackgroundRun }
