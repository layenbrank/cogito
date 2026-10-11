import { ModeItem } from './run-menu-parts.tsx'
import type { useGuardRun } from './use-guard-run'
import type { Caps } from './run-caps'

type GuardRun = ReturnType<typeof useGuardRun>

interface RunGuardCronItemProps {
  guard: GuardRun
  caps: Caps
  onStartGuard: () => void
}

function RunGuardCronItem(props: RunGuardCronItemProps) {
  if (props.guard.alive.cron) {
    return (
      <ModeItem
        icon={props.guard.isCronStopping ? 'mdi:timer-sand' : 'mdi:stop'}
        label={props.guard.isCronStopping ? '正在停止 cron' : '停止 cron'}
        hint={
          props.guard.isCronStopping
            ? '已请求停止，等待本次结束'
            : props.guard.isCronRunning
              ? '当前有任务在跑'
              : '结束定时守护'
        }
        onSelect={function () {
          props.guard.requestStop('cron')
        }}
      />
    )
  }

  return (
    <ModeItem
      icon="mdi:clock-outline"
      label="以 cron 守护"
      hint={props.caps.hasCron ? '按表达式定时触发' : '指令未声明 cron 触发器'}
      disabled={!props.caps.hasCron || props.guard.isBusy}
      onSelect={props.onStartGuard}
    />
  )
}

export { RunGuardCronItem }
