import { Label } from '@i-thinking/design/components/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'
import { cn } from 'cn'
import { useState, type ReactNode } from 'react'

interface HintTooltipProps {
  hint: string
  children: ReactNode
  htmlFor?: string
  className?: string
}

/**
 * 说明挂在标签文字上：悬停才挂载 Content，关掉即销毁。
 * 虚线下划线提示可悬停，不再单独放 ⓘ。
 */
function HintTooltip(props: HintTooltipProps) {
  const [isOpen, updateOpen] = useState(false)

  return (
    <TooltipProvider delay={320}>
      <Tooltip
        open={isOpen}
        onOpenChange={updateOpen}>
        <TooltipTrigger
          render={
            <Label
              htmlFor={props.htmlFor}
              className={cn(
                'w-fit cursor-help underline decoration-dotted decoration-foreground/30 underline-offset-[3px]',
                'hover:decoration-foreground/55',
                props.className
              )}
            />
          }>
          {props.children}
        </TooltipTrigger>
        {isOpen ? (
          <TooltipContent
            side="top"
            className="max-w-64 text-left text-balance">
            {props.hint}
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TooltipProvider>
  )
}

export { HintTooltip }
