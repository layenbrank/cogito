import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Spinner } from '@i-thinking/design/components/spinner'
import { cn } from 'cn'

interface IncrementButtonProps {
  tileTitle: string
  isIncrementing: boolean
  onIncrement: () => void
  className?: string
}

function IncrementButton(props: IncrementButtonProps) {
  return (
    <Button
      size="icon-sm"
      title="新增到镜像"
      aria-label={`新增 ${props.tileTitle}`}
      aria-busy={props.isIncrementing}
      disabled={props.isIncrementing}
      className={cn('rounded-md', props.className)}
      onClick={function (event) {
        event.stopPropagation()
        props.onIncrement()
      }}>
      {props.isIncrementing ? (
        <Spinner />
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
