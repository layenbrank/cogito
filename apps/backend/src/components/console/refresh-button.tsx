import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'

interface RefreshButtonProps {
  isFetching?: boolean
  onRefresh(): void
}

/** 列表刷新：放在筛选行右侧，不进底部分页条。 */
function RefreshButton(props: RefreshButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 shrink-0 gap-2 px-3"
      disabled={props.isFetching}
      aria-label="刷新"
      onClick={function () {
        props.onRefresh()
      }}>
      <Icon
        icon="lucide:refresh-cw"
        className={clsx('size-4', props.isFetching && 'animate-spin')}
      />
      刷新
    </Button>
  )
}

export { RefreshButton }
