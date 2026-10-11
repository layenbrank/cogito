import { ModeItem } from './run-menu-parts.tsx'
import type { useGuardRun } from './use-guard-run'
import type { Caps } from './run-caps'

type GuardRun = ReturnType<typeof useGuardRun>

interface RunGuardWatchItemProps {
  guard: GuardRun
  caps: Caps
  onStartGuard: () => void
}

function RunGuardWatchItem(props: RunGuardWatchItemProps) {
  if (props.guard.alive.watch) {
    return (
      <ModeItem
        icon={props.guard.isWatchStopping ? 'mdi:timer-sand' : 'mdi:stop'}
        label={props.guard.isWatchStopping ? '正在停止 watch' : '停止 watch'}
        hint={
          props.guard.isWatchStopping
            ? '已请求停止，等待本次结束'
            : props.guard.isWatchRunning
              ? '当前有任务在跑'
              : '结束文件监听'
        }
        onSelect={function () {
          props.guard.requestStop('watch')
        }}
      />
    )
  }

  return (
    <ModeItem
      icon="mdi:eye-outline"
      label="以 watch 守护"
      hint={props.caps.hasWatch ? '文件变更时触发' : '指令未声明 watch 触发器'}
      disabled={!props.caps.hasWatch || props.guard.isBusy}
      onSelect={props.onStartGuard}
    />
  )
}

export { RunGuardWatchItem }
