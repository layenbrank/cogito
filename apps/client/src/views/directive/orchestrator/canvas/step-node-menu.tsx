import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Icon } from '@iconify/react/offline'

interface StepNodeMenuProps {
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
  onRemove: () => void
}

function StepNodeMenu(props: StepNodeMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md opacity-70 hover:bg-muted hover:opacity-100"
        aria-label="步骤菜单"
        onClick={function (event) {
          event.stopPropagation()
        }}>
        <Icon
          icon="lucide:more-horizontal"
          className="size-4"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={props.onMoveUp}>
          <Icon
            icon="lucide:arrow-up"
            className="size-4"
          />
          上移
        </DropdownMenuItem>
        <DropdownMenuItem onClick={props.onMoveDown}>
          <Icon
            icon="lucide:arrow-down"
            className="size-4"
          />
          下移
        </DropdownMenuItem>
        <DropdownMenuItem onClick={props.onDuplicate}>
          <Icon
            icon="lucide:copy"
            className="size-4"
          />
          复制
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={props.onRemove}>
          <Icon
            icon="lucide:trash-2"
            className="size-4"
          />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { StepNodeMenu }
