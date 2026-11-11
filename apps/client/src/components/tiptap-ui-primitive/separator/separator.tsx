'use client'

import { forwardRef } from 'react'
import { Separator as DesignSeparator } from '@cogito/design/components/separator'
import { cn } from '@/lib/tiptap-utils.ts'

export type Orientation = 'horizontal' | 'vertical'

export interface SeparatorProps
  extends Omit<React.ComponentProps<typeof DesignSeparator>, 'orientation'> {
  orientation?: Orientation
}

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(function Separator(
  { orientation = 'vertical', className, ...props },
  ref
) {
  return (
    <DesignSeparator
      ref={ref}
      orientation={orientation}
      className={cn(
        orientation === 'vertical' ? 'mx-0.5 h-auto self-stretch' : 'my-0.5 w-full',
        typeof className === 'string' ? className : undefined
      )}
      {...props}
    />
  )
})

Separator.displayName = 'Separator'
