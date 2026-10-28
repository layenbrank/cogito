'use client'

import { Input as DesignInput } from '@cogito/design/components/input'
import { cn } from '@/lib/tiptap-utils.ts'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <DesignInput
      type={type}
      className={cn('h-8', className)}
      {...props}
    />
  )
}

function InputGroup({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex w-full items-center gap-1.5', className)}
      {...props}>
      {children}
    </div>
  )
}

export { Input, InputGroup }
