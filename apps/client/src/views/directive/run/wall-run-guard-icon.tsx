import type { JobKind } from '@/shared/ipc/specs/sidecar'

import {
  findGuardBarHint,
  findGuardBarLabel,
  findGuardIcon
} from './guard-action-copy.ts'
import { ActionIcon } from './run-menu-parts.tsx'
import type { useGuardRun } from './use-guard-run'

type GuardRun = ReturnType<typeof useGuardRun>

interface WallRunGuardIconProps {
  kind: JobKind
  name: string
  guard: GuardRun
  disabled: boolean
  onGuardClick: (kind: JobKind) => void
}

function WallRunGuardIcon(props: WallRunGuardIconProps) {
  const guard = props.guard
  const alive = props.kind === 'cron' ? guard.alive.cron : guard.alive.watch
  const stopping = props.kind === 'cron' ? guard.isCronStopping : guard.isWatchStopping
  const running = props.kind === 'cron' ? guard.isCronRunning : guard.isWatchRunning

  return (
    <ActionIcon
      icon={findGuardIcon(props.kind, guard)}
      label={findGuardBarLabel(props.kind, props.name, guard)}
      hint={findGuardBarHint(props.kind, guard)}
      isActive={alive || running}
      isBusy={running || stopping}
      disabled={props.disabled}
      onClick={function () {
        props.onGuardClick(props.kind)
      }}
    />
  )
}

export { WallRunGuardIcon }
