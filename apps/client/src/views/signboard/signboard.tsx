import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { useShellSurface } from '@/features/window-shell/slots'
import { BoardView } from '@/views/signboard/board-view.tsx'

export default function Signboard() {
  useShellSurface({
    summary: findComponentLabel('signboard'),
    scrollable: false
  })

  return (
    <div className="mt-stage">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <BoardView />
      </div>
    </div>
  )
}
