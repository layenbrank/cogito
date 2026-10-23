import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
/**
 * 只读面板上的「现在取一次」按钮。
 *
 * 请求在飞时图标转、按钮禁用：连点没有意义（react-query 会去重，但按钮转起来用户才知道确实
 * 发出去了），同时这也把**自动**刷新暴露出来 —— 对话结束时那一轮刷新会让它跟着转。
 *
 * `iconOnly` 给放不下文字的地方（popover 标题行、右栏卡片角上）：这时 `label` 同时是
 * `aria-label` 与 `title`，否则屏幕阅读器只能念出一个没有名字的按钮。
 */
function RefreshButton(props: {
  isFetching: boolean
  onRefresh(): void
  label?: string
  iconOnly?: boolean
  className?: string
}) {
  const label = props.label ?? '刷新'

  return (
    <Button
      type="button"
      variant="ghost"
      size={props.iconOnly ? 'icon-sm' : 'sm'}
      className={cn('text-muted-foreground', props.className)}
      disabled={props.isFetching}
      aria-label={props.iconOnly ? label : undefined}
      title={label}
      onClick={props.onRefresh}>
      <Icon icon="lucide:refresh-cw" className={cn(props.isFetching && 'animate-spin')} />
      {props.iconOnly ? null : label}
    </Button>
  )
}

export { RefreshButton }
