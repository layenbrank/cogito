'use client'

import { createElement, forwardRef } from 'react'
import { cn } from '@/lib/tiptap-utils.ts'

export interface BaseProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'label' | 'div'
  onMouseDown?: React.MouseEventHandler<HTMLElement>
}

export type LabelProps<T extends 'label' | 'div'> = T extends 'label'
  ? BaseProps & { htmlFor?: string }
  : BaseProps

export const Label = forwardRef<HTMLElement, LabelProps<'label'> | LabelProps<'div'>>(
  function Label({ as = 'div', className, ...props }, ref) {
    const renderProps = { ...props }

    if (as === 'label') {
      renderProps.onMouseDown = function (event: React.MouseEvent<HTMLElement>) {
        const target = event.target as HTMLElement
        if (target.closest('button, input, select, textarea')) return
        props.onMouseDown?.(event)
        if (!event.defaultPrevented && event.detail > 1) event.preventDefault()
      }
    }

    return createElement(as, {
      ...renderProps,
      ref,
      className: cn('text-xs font-medium text-muted-foreground', className)
    })
  }
)

Label.displayName = 'Label'

export default Label
