import { Icon } from '@iconify/react/offline'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'
import { useState } from 'react'

interface HintTooltipProps {
  hint: string
  label: string
}

/**
 * 标签旁说明：悬停才挂载 Content，关掉即销毁，不占纵向空间。
 */
function HintTooltip(props: HintTooltipProps) {
  const [isOpen, updateOpen] = useState(false)

  return (
    <Tooltip
      open={isOpen}
      onOpenChange={updateOpen}>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-foreground/45 hover:text-foreground"
            aria-label={props.label}
            onPointerDown={function (event) {
              // 不抢焦点，避免输入框失焦
              event.preventDefault()
            }}>
            <Icon
              icon="mdi:information-outline"
              className="size-3.5"
            />
          </button>
        }
      />
      {isOpen ? (
        <TooltipContent
          side="top"
          className="max-w-64 text-left text-balance">
          {props.hint}
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}

export { HintTooltip }
