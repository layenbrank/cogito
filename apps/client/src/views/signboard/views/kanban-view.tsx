import { KanbanBoardSurface } from '@/views/signboard/views/kanban-board-surface.tsx'
import {
  useKanbanBoard,
  type KanbanViewProps
} from '@/views/signboard/views/use-kanban-board.ts'

function KanbanView(props: KanbanViewProps) {
  const vm = useKanbanBoard(props)
  return <KanbanBoardSurface {...vm} />
}

export { KanbanView }
export type { KanbanViewProps }
