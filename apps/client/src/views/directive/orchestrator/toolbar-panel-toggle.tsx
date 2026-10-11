import { Button } from '@i-thinking/design/components/button'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

interface PanelToggleProps {
  open: boolean
  openIcon: string
  closeIcon: string
  labelOpen: string
  labelClose: string
  onClick: () => void
}

function PanelToggle(props: PanelToggleProps) {
  return (
    <Button
      size="sm"
      variant={props.open ? 'secondary' : 'ghost'}
      onClick={props.onClick}
      aria-label={props.open ? props.labelClose : props.labelOpen}
      aria-pressed={props.open}
      className="transition-[background-color,color,transform] duration-200">
      <Icon
        key={props.open ? props.closeIcon : props.openIcon}
        icon={props.open ? props.closeIcon : props.openIcon}
        className={cn(
          'size-4 transition-[transform,opacity] duration-200 ease-out',
          props.open ? 'scale-100 opacity-100' : 'scale-95 opacity-80'
        )}
      />
    </Button>
  )
}

export { PanelToggle }
