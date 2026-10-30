import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

interface EmptyHintProps {
  description: string
  actionLabel?: string
  onAction?: () => void
}

/** 分类为空或搜索无结果 */
function EmptyHint(props: EmptyHintProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-sm text-foreground/65">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-foreground/50">
        <Icon
          icon="lucide:layout-grid"
          className="size-5"
          aria-hidden
        />
      </div>
      <span className="text-center">{props.description}</span>
      {props.actionLabel && props.onAction ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onAction}>
          {props.actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export type { EmptyHintProps }
export { EmptyHint }
