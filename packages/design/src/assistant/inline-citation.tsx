import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps } from 'react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { Badge } from '../components/badge'
import { Button } from '../components/button'
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover'

type InlineCitationProps = ComponentProps<'span'>

function InlineCitation({ className, ...props }: InlineCitationProps) {
  return (
    <span
      data-slot="inline-citation"
      className={cn('group inline items-center gap-1', className)}
      {...props}
    />
  )
}

type InlineCitationTextProps = ComponentProps<'span'>

function InlineCitationText({ className, ...props }: InlineCitationTextProps) {
  return (
    <span
      className={cn('transition-colors group-hover:bg-accent', className)}
      {...props}
    />
  )
}

type InlineCitationCardProps = ComponentProps<typeof Popover>

function InlineCitationCard(props: InlineCitationCardProps) {
  return (
    <Popover
      data-slot="inline-citation-card"
      {...props}
    />
  )
}

type InlineCitationCardTriggerProps = ComponentProps<typeof Badge> & {
  sources: string[]
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function InlineCitationCardTrigger({ sources, className, ...props }: InlineCitationCardTriggerProps) {
  return (
    <PopoverTrigger
      render={
        <Badge
          className={cn('ml-1 rounded-full', className)}
          variant="secondary"
          {...props}
        />
      }>
      {sources[0] ? (
        <>
          {hostnameOf(sources[0])} {sources.length > 1 ? `+${sources.length - 1}` : ''}
        </>
      ) : (
        'unknown'
      )}
    </PopoverTrigger>
  )
}

type InlineCitationCardBodyProps = ComponentProps<'div'>

function InlineCitationCardBody({ className, ...props }: InlineCitationCardBodyProps) {
  return (
    <PopoverContent
      className={cn('relative w-80 p-0', className)}
      data-slot="inline-citation-card-body"
      {...props}
    />
  )
}

interface InlineCitationCarouselContextValue {
  index: number
  count: number
  setIndex: (index: number) => void
}

const InlineCitationCarouselContext = createContext<InlineCitationCarouselContextValue | null>(
  null
)

function useInlineCitationCarousel() {
  const context = useContext(InlineCitationCarouselContext)
  if (!context) {
    throw new Error('InlineCitationCarousel* must be used within InlineCitationCarousel')
  }
  return context
}

type InlineCitationCarouselProps = ComponentProps<'div'> & {
  defaultIndex?: number
  count?: number
}

function InlineCitationCarousel({
  className,
  children,
  defaultIndex = 0,
  count: countProp,
  ...props
}: InlineCitationCarouselProps) {
  const [index, setIndex] = useState(defaultIndex)
  const childCount = countProp ?? (Array.isArray(children) ? children.length : 1)
  const contextValue = useMemo(
    function () {
      return { count: childCount, index, setIndex }
    },
    [childCount, index]
  )

  return (
    <InlineCitationCarouselContext.Provider value={contextValue}>
      <div
        className={cn('w-full', className)}
        data-slot="inline-citation-carousel"
        {...props}>
        {children}
      </div>
    </InlineCitationCarouselContext.Provider>
  )
}

type InlineCitationCarouselContentProps = ComponentProps<'div'>

function InlineCitationCarouselContent({
  children,
  className,
  ...props
}: InlineCitationCarouselContentProps) {
  const { index } = useInlineCitationCarousel()
  const items = Array.isArray(children) ? children : [children]
  return (
    <div
      className={cn('relative', className)}
      {...props}>
      {items.map(function (item, itemIndex) {
        if (!item) return null
        return (
          <div
            className={cn(itemIndex === index ? 'block' : 'hidden')}
            key={itemIndex}>
            {item}
          </div>
        )
      })}
    </div>
  )
}

type InlineCitationCarouselItemProps = ComponentProps<'div'>

function InlineCitationCarouselItem({ className, ...props }: InlineCitationCarouselItemProps) {
  return (
    <div
      className={cn('w-full space-y-2 p-4 pl-8', className)}
      {...props}
    />
  )
}

type InlineCitationCarouselHeaderProps = ComponentProps<'div'>

function InlineCitationCarouselHeader({ className, ...props }: InlineCitationCarouselHeaderProps) {
  return (
    <div
      className={cn(
        'bg-secondary flex items-center justify-between gap-2 rounded-t-md p-2',
        className
      )}
      {...props}
    />
  )
}

type InlineCitationCarouselIndexProps = ComponentProps<'div'>

function InlineCitationCarouselIndex({
  children,
  className,
  ...props
}: InlineCitationCarouselIndexProps) {
  const { index, count } = useInlineCitationCarousel()
  return (
    <div
      className={cn(
        'text-muted-foreground flex flex-1 items-center justify-end px-3 py-1 text-xs',
        className
      )}
      {...props}>
      {children ?? `${index + 1}/${count}`}
    </div>
  )
}

type InlineCitationCarouselPrevProps = ComponentProps<typeof Button>

function InlineCitationCarouselPrev({ className, ...props }: InlineCitationCarouselPrevProps) {
  const { index, setIndex, count } = useInlineCitationCarousel()
  const handleClick = useCallback(
    function () {
      setIndex(index > 0 ? index - 1 : count - 1)
    },
    [count, index, setIndex]
  )

  return (
    <Button
      type="button"
      aria-label="Previous"
      variant="ghost"
      size="icon-sm"
      className={cn('shrink-0', className)}
      onClick={handleClick}
      {...props}>
      <Icon
        icon="lucide:arrow-left"
        className="text-muted-foreground size-4"
      />
    </Button>
  )
}

type InlineCitationCarouselNextProps = ComponentProps<typeof Button>

function InlineCitationCarouselNext({ className, ...props }: InlineCitationCarouselNextProps) {
  const { index, setIndex, count } = useInlineCitationCarousel()
  const handleClick = useCallback(
    function () {
      setIndex(index < count - 1 ? index + 1 : 0)
    },
    [count, index, setIndex]
  )

  return (
    <Button
      type="button"
      aria-label="Next"
      variant="ghost"
      size="icon-sm"
      className={cn('shrink-0', className)}
      onClick={handleClick}
      {...props}>
      <Icon
        icon="lucide:arrow-right"
        className="text-muted-foreground size-4"
      />
    </Button>
  )
}

type InlineCitationSourceProps = ComponentProps<'div'> & {
  title?: string
  url?: string
  description?: string
}

function InlineCitationSource({
  title,
  url,
  description,
  className,
  children,
  ...props
}: InlineCitationSourceProps) {
  return (
    <div
      className={cn('space-y-1', className)}
      {...props}>
      {title ? <h4 className="truncate text-sm leading-tight font-medium">{title}</h4> : null}
      {url ? <p className="text-muted-foreground truncate text-xs break-all">{url}</p> : null}
      {description ? (
        <p className="text-muted-foreground line-clamp-3 text-sm leading-relaxed">{description}</p>
      ) : null}
      {children}
    </div>
  )
}

type InlineCitationQuoteProps = ComponentProps<'blockquote'>

function InlineCitationQuote({ children, className, ...props }: InlineCitationQuoteProps) {
  return (
    <blockquote
      className={cn('border-muted border-l-2 pl-3 text-sm text-muted-foreground italic', className)}
      {...props}>
      {children}
    </blockquote>
  )
}

export {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationQuote,
  InlineCitationSource,
  InlineCitationText
}
