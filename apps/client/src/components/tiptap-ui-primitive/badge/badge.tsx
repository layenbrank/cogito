'use client'

import { forwardRef } from 'react'
import { Badge as DesignBadge } from '@cogito/design/components/badge'
import { cn } from '@/lib/tiptap-utils.ts'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'ghost' | 'white' | 'gray' | 'green' | 'default'
  size?: 'default' | 'small'
  appearance?: 'default' | 'subdued' | 'emphasized'
  trimText?: boolean
}

function mapVariant(
  variant: BadgeProps['variant']
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (variant === 'green') return 'default'
  if (variant === 'ghost' || variant === 'white' || variant === 'gray') return 'secondary'
  return 'outline'
}

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(function Badge(
  { variant = 'default', size = 'default', className, children, ...props },
  ref
) {
  return (
    <DesignBadge
      ref={ref as never}
      variant={mapVariant(variant)}
      className={cn(size === 'small' && 'px-1 text-[10px]', className)}
      {...props}>
      {children}
    </DesignBadge>
  )
})

Badge.displayName = 'Badge'

export default Badge
