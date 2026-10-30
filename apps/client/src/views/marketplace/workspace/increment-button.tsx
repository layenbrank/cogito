import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Spinner } from '@cogito/design/components/spinner'
import { cn } from 'cn'

interface IncrementButtonProps {
  tileTitle: string
  isIncrementing: boolean
  showsCheck?: boolean
  onIncrement: () => void
  className?: string
}

function IncrementButton(props: IncrementButtonProps) {
  const isBusy = props.isIncrementing
  const showsCheck = !!props.showsCheck

  return (
    <Button
      size="icon-sm"
      title="新增到镜像"
      aria-label={`新增 ${props.tileTitle}`}
      aria-busy={isBusy}
      disabled={isBusy || showsCheck}
      className={cn('rounded-lg', props.className)}
      onClick={function (event) {
        event.stopPropagation()
        props.onIncrement()
      }}>
      {isBusy ? (
        <Spinner />
      ) : showsCheck ? (
        <Icon
          icon="lucide:check"
          aria-hidden
        />
      ) : (
        <Icon
          icon="lucide:plus"
          aria-hidden
        />
      )}
    </Button>
  )
}

export { IncrementButton }
