import { Spinner } from '@cogito/design/components/spinner'

import { BoardViewDialogs } from '@/views/signboard/board-view-dialogs.tsx'
import { BoardViewShell } from '@/views/signboard/board-view-shell.tsx'
import { useBoardView } from '@/views/signboard/use-board-view.ts'

function BoardView() {
  const state = useBoardView()

  if (!state.loaded) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-5" />
        加载看板…
      </div>
    )
  }

  return (
    <>
      <BoardViewShell {...state} />
      <BoardViewDialogs {...state} />
    </>
  )
}

export { BoardView }
