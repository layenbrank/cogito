import type { JobKind } from '@/shared/ipc/specs/sidecar'

import type { Caps } from './run-caps'
import { haltBubble } from './halt-bubble.ts'
import { ActionIcon, StopGuardDialog } from './run-menu-parts.tsx'
import { useWallRunCaps } from './use-wall-run-caps.ts'
import { WallRunGuardIcon } from './wall-run-guard-icon.tsx'
import { useGuardRun } from './use-guard-run'

interface WallRunBarProps {
  name: string
  caps: Caps
  onOnce: () => void
  disabled?: boolean
}

function WallRunBar(props: WallRunBarProps) {
  const guard = useGuardRun({ name: props.name })
  const caps = useWallRunCaps(props.name, props.caps, guard.refreshAlive)
  const isDisabled = props.disabled || !props.name || guard.isBusy

  function onGuardClick(kind: JobKind) {
    const isAliveGuard = kind === 'cron' ? guard.alive.cron : guard.alive.watch
    if (isAliveGuard) {
      guard.requestStop(kind)
      return
    }
    void guard.startGuard(kind)
  }

  return (
    <div
      className="relative z-10 flex shrink-0 items-center gap-1"
      onPointerDown={haltBubble}>
      <ActionIcon
        icon="mdi:play"
        label={`运行 ${props.name}`}
        hint="单次运行"
        disabled={isDisabled}
        onClick={props.onOnce}
      />
      {caps.hasCron ? (
        <WallRunGuardIcon
          kind="cron"
          name={props.name}
          guard={guard}
          disabled={isDisabled}
          onGuardClick={onGuardClick}
        />
      ) : null}
      {caps.hasWatch ? (
        <WallRunGuardIcon
          kind="watch"
          name={props.name}
          guard={guard}
          disabled={isDisabled}
          onGuardClick={onGuardClick}
        />
      ) : null}
      <StopGuardDialog
        kind={guard.stopKind}
        name={props.name}
        isBusy={guard.isBusy}
        onClose={guard.closeStopDialog}
        onPick={function (force) {
          if (!guard.stopKind) return
          void guard.confirmStop(guard.stopKind, force)
        }}
      />
    </div>
  )
}

export { WallRunBar }
