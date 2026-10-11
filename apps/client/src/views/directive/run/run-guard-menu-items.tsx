import type { Caps } from './run-caps'
import { RunGuardCronItem } from './run-guard-cron-item.tsx'
import { RunGuardWatchItem } from './run-guard-watch-item.tsx'
import type { useGuardRun } from './use-guard-run'

type GuardRun = ReturnType<typeof useGuardRun>

interface RunGuardMenuItemsProps {
  guard: GuardRun
  caps: Caps
  onStartGuard: (kind: 'cron' | 'watch') => void
}

function RunGuardMenuItems(props: RunGuardMenuItemsProps) {
  return (
    <>
      <RunGuardCronItem
        guard={props.guard}
        caps={props.caps}
        onStartGuard={function () {
          props.onStartGuard('cron')
        }}
      />
      <RunGuardWatchItem
        guard={props.guard}
        caps={props.caps}
        onStartGuard={function () {
          props.onStartGuard('watch')
        }}
      />
    </>
  )
}

export { RunGuardMenuItems }
