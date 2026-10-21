import { Button } from '@i-thinking/design/components/button'
import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'

interface RailToggleProps {
  isCollapsed: boolean
  onToggle(): void
  className?: string
}

/**
 * 顶栏自定义触发器（对齐 antd `trigger={null}` 后自行放置的折叠钮）。
 * 侧栏本体另有底部 bar / 贴边圆钮，见 RailTrigger*。
 */
function RailToggle(props: RailToggleProps) {
  const label = props.isCollapsed ? '展开侧栏' : '收起侧栏'

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={clsx('size-8 shrink-0 text-muted-foreground', props.className)}
      aria-label={label}
      aria-pressed={props.isCollapsed}
      title={`${label} ⌘B`}
      onClick={props.onToggle}>
      <Icon
        icon={props.isCollapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'}
        className="size-4"
      />
    </Button>
  )
}

export { RailToggle }
