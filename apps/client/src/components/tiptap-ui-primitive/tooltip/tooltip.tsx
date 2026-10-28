'use client'

import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import {
  Tooltip as DesignTooltip,
  TooltipContent as DesignContent,
  TooltipProvider as DesignProvider,
  TooltipTrigger as DesignTrigger
} from '@cogito/design/components/tooltip'

function TooltipProvider(props: ComponentPropsWithoutRef<typeof DesignProvider>) {
  return <DesignProvider {...props} />
}

function Tooltip(props: ComponentPropsWithoutRef<typeof DesignTooltip> & { delay?: number }) {
  const { delay, ...rest } = props
  if (delay !== undefined) {
    return (
      <DesignProvider delay={delay}>
        <DesignTooltip {...rest} />
      </DesignProvider>
    )
  }
  return <DesignTooltip {...rest} />
}

function TooltipTrigger(props: ComponentPropsWithoutRef<typeof DesignTrigger>) {
  return <DesignTrigger {...props} />
}

function TooltipContent({
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DesignContent> & { children?: ReactNode }) {
  return <DesignContent {...props}>{children}</DesignContent>
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
