// @ts-nocheck
'use client'

import { forwardRef, Fragment, useMemo } from 'react'

// --- Tiptap UI Primitive ---
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/tiptap-ui-primitive/tooltip/tooltip.tsx'

// --- Lib ---
import { Kbd, KbdGroup } from '@i-thinking/design/components/kbd'
import { cn, parseShortcutKeys } from '@/lib/tiptap-utils'

import '@/components/tiptap-ui-primitive/button/button-colors.scss'
import '@/components/tiptap-ui-primitive/button/button-group.scss'
import '@/components/tiptap-ui-primitive/button/button.scss'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
  showTooltip?: boolean
  tooltip?: React.ReactNode
  shortcutKeys?: string
}

/** Tooltip 内快捷键展示：用设计系统 Kbd，不挤在操作栏里 */
export const ShortcutDisplay: React.FC<{ shortcuts: string[] }> = ({
  shortcuts
}) => {
  if (shortcuts.length === 0) return null

  return (
    <KbdGroup>
      {shortcuts.map((key, index) => (
        <Fragment key={key}>
          {index > 0 ? (
            <span className="tiptap-shortcut-plus px-0.5 text-xs opacity-50">
              +
            </span>
          ) : null}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      children,
      tooltip,
      showTooltip = true,
      shortcutKeys,
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    const shortcuts = useMemo<string[]>(
      () => parseShortcutKeys({ shortcutKeys }),
      [shortcutKeys]
    )

    if (!tooltip || !showTooltip) {
      return (
        <button
          className={cn('tiptap-button', className)}
          ref={ref}
          aria-label={ariaLabel}
          {...props}>
          {children}
        </button>
      )
    }

    return (
      <Tooltip delay={200}>
        <TooltipTrigger
          className={cn('tiptap-button', className)}
          ref={ref}
          aria-label={ariaLabel}
          {...props}>
          {children}
        </TooltipTrigger>
        <TooltipContent>
          <span className="inline-flex items-center gap-1.5">
            <span>{tooltip}</span>
            <ShortcutDisplay shortcuts={shortcuts} />
          </span>
        </TooltipContent>
      </Tooltip>
    )
  }
)

Button.displayName = 'Button'

export const ButtonGroup = forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & {
    orientation?: 'horizontal' | 'vertical'
  }
>(({ className, children, orientation = 'vertical', ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn('tiptap-button-group', className)}
      data-orientation={orientation}
      role="group"
      {...props}>
      {children}
    </div>
  )
})
ButtonGroup.displayName = 'ButtonGroup'

export default Button
