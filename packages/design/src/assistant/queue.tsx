import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'

import { Button } from '../components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'
import { ScrollArea } from '../components/scroll-area'

interface QueueMessagePart {
  type: string
  text?: string
  url?: string
  filename?: string
  mediaType?: string
}

interface QueueMessage {
  id: string
  parts: QueueMessagePart[]
}

interface QueueTodo {
  id: string
  title: string
  description?: string
  status?: 'pending' | 'completed'
}

type QueueItemProps = ComponentProps<'li'>

function QueueItem({ className, ...props }: QueueItemProps) {
  return (
    <li
      data-slot="queue-item"
      className={cn(
        'group flex flex-col gap-1 rounded-md px-3 py-1 text-sm transition-colors hover:bg-muted',
        className
      )}
      {...props}
    />
  )
}

type QueueItemIndicatorProps = ComponentProps<'span'> & {
  completed?: boolean
}

function QueueItemIndicator({ completed = false, className, ...props }: QueueItemIndicatorProps) {
  return (
    <span
      className={cn(
        'mt-0.5 inline-block size-2.5 rounded-full border',
        completed
          ? 'border-muted-foreground/20 bg-muted-foreground/10'
          : 'border-muted-foreground/50',
        className
      )}
      {...props}
    />
  )
}

type QueueItemContentProps = ComponentProps<'span'> & {
  completed?: boolean
}

function QueueItemContent({ completed = false, className, ...props }: QueueItemContentProps) {
  return (
    <span
      className={cn(
        'line-clamp-1 grow break-words',
        completed ? 'text-muted-foreground/50 line-through' : 'text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

type QueueItemDescriptionProps = ComponentProps<'div'> & {
  completed?: boolean
}

function QueueItemDescription({
  completed = false,
  className,
  ...props
}: QueueItemDescriptionProps) {
  return (
    <div
      className={cn(
        'ml-6 text-xs',
        completed ? 'text-muted-foreground/40 line-through' : 'text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

type QueueItemActionsProps = ComponentProps<'div'>

function QueueItemActions({ className, ...props }: QueueItemActionsProps) {
  return (
    <div
      className={cn('flex gap-1', className)}
      {...props}
    />
  )
}

type QueueItemActionProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'>

function QueueItemAction({ className, ...props }: QueueItemActionProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        'text-muted-foreground size-auto rounded p-1 opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground group-hover:opacity-100',
        className
      )}
      {...props}
    />
  )
}

type QueueItemAttachmentProps = ComponentProps<'div'>

function QueueItemAttachment({ className, ...props }: QueueItemAttachmentProps) {
  return (
    <div
      className={cn('mt-1 flex flex-wrap gap-2', className)}
      {...props}
    />
  )
}

type QueueItemImageProps = ComponentProps<'img'>

function QueueItemImage({ className, ...props }: QueueItemImageProps) {
  return (
    <img
      alt=""
      className={cn('h-8 w-8 rounded border object-cover', className)}
      height={32}
      width={32}
      {...props}
    />
  )
}

type QueueItemFileProps = ComponentProps<'span'>

function QueueItemFile({ children, className, ...props }: QueueItemFileProps) {
  return (
    <span
      className={cn(
        'bg-muted flex items-center gap-1 rounded border px-2 py-1 text-xs',
        className
      )}
      {...props}>
      <Icon
        icon="lucide:paperclip"
        className="size-3"
      />
      <span className="max-w-[100px] truncate">{children}</span>
    </span>
  )
}

type QueueListProps = ComponentProps<typeof ScrollArea>

function QueueList({ children, className, ...props }: QueueListProps) {
  return (
    <ScrollArea
      className={cn('mt-2 -mb-1', className)}
      {...props}>
      <div className="max-h-40 pr-4">
        <ul>{children}</ul>
      </div>
    </ScrollArea>
  )
}

type QueueSectionProps = ComponentProps<typeof Collapsible>

function QueueSection({ className, defaultOpen = true, ...props }: QueueSectionProps) {
  return (
    <Collapsible
      className={cn(className)}
      defaultOpen={defaultOpen}
      data-slot="queue-section"
      {...props}
    />
  )
}

type QueueSectionTriggerProps = ComponentProps<'button'>

function QueueSectionTrigger({ children, className, ...props }: QueueSectionTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn('inline-flex w-full', className)}
      render={
        <button
          type="button"
          className="group flex w-full items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
        />
      }
      {...props}>
      {children}
    </CollapsibleTrigger>
  )
}

type QueueSectionLabelProps = ComponentProps<'span'> & {
  count?: number
  label: string
  icon?: ReactNode
}

function QueueSectionLabel({ count, label, icon, className, ...props }: QueueSectionLabelProps) {
  return (
    <span
      className={cn('flex items-center gap-2', className)}
      {...props}>
      <Icon
        icon="lucide:chevron-down"
        className="size-4 transition-transform group-data-[panel-open]:rotate-180"
      />
      {icon}
      <span>
        {count !== undefined ? `${count} ` : ''}
        {label}
      </span>
    </span>
  )
}

type QueueSectionContentProps = ComponentProps<typeof CollapsibleContent>

function QueueSectionContent({ className, ...props }: QueueSectionContentProps) {
  return (
    <CollapsibleContent
      className={cn(className)}
      {...props}
    />
  )
}

type QueueProps = ComponentProps<'div'>

function Queue({ className, ...props }: QueueProps) {
  return (
    <div
      data-slot="queue"
      className={cn(
        'border-border bg-background flex flex-col gap-2 rounded-xl border px-3 pt-2 pb-2 shadow-xs',
        className
      )}
      {...props}
    />
  )
}

export {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemAttachment,
  QueueItemContent,
  QueueItemDescription,
  QueueItemFile,
  QueueItemImage,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger
}
export type {
  QueueMessage,
  QueueMessagePart,
  QueueProps,
  QueueTodo
}
