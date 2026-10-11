import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Spinner } from '@i-thinking/design/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'

interface IncrementButtonProps {
  tileTitle: string
  isIncrementing: boolean
  onIncrement: () => void
}

function IncrementButton(props: IncrementButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            aria-label={`新增 ${props.tileTitle}`}
            aria-busy={props.isIncrementing}
            disabled={props.isIncrementing}
            onClick={function (event) {
              event.stopPropagation()
              props.onIncrement()
            }}
          />
        }>
        {props.isIncrementing ? (
          <Spinner />
        ) : (
          <Icon
            icon="lucide:plus"
            aria-hidden
          />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">新增到镜像</TooltipContent>
    </Tooltip>
  )
}

export { IncrementButton }
