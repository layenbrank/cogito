import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, ReactNode } from 'react'
import { useCallback } from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'

import { Button } from '../components/button'

type ConversationProps = ComponentProps<typeof StickToBottom>

function Conversation({ className, ...props }: ConversationProps) {
  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden', className)}
      initial="smooth"
      resize="smooth"
      role="log"
      data-slot="conversation"
      {...props}
    />
  )
}

type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>

function ConversationContent({ className, ...props }: ConversationContentProps) {
  return (
    <StickToBottom.Content
      className={cn('flex flex-col gap-8 p-4', className)}
      data-slot="conversation-content"
      {...props}
    />
  )
}

type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string
  description?: string
  icon?: ReactNode
}

function ConversationEmptyState({
  className,
  title = 'No messages yet',
  description = 'Start a conversation to see messages here',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
        className
      )}
      data-slot="conversation-empty"
      {...props}>
      {children ?? (
        <>
          {icon ? <div className="text-muted-foreground">{icon}</div> : null}
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{title}</h3>
            {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
          </div>
        </>
      )}
    </div>
  )
}

type ConversationScrollButtonProps = ComponentProps<typeof Button>

function ConversationScrollButton({ className, ...props }: ConversationScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  const handleScrollToBottom = useCallback(
    function () {
      scrollToBottom()
    },
    [scrollToBottom]
  )

  if (isAtBottom) return null

  return (
    <Button
      type="button"
      className={cn(
        'absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted',
        className
      )}
      onClick={handleScrollToBottom}
      size="icon"
      variant="outline"
      data-slot="conversation-scroll-button"
      {...props}>
      <Icon
        icon="lucide:arrow-down"
        className="size-4"
      />
    </Button>
  )
}

interface ConversationExportMessage {
  role: string
  text: string
}

type ConversationDownloadProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  messages: ConversationExportMessage[]
  filename?: string
  formatMessage?: (message: ConversationExportMessage, index: number) => string
}

function defaultFormatMessage(message: ConversationExportMessage): string {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1)
  return `**${roleLabel}:** ${message.text}`
}

function messagesToMarkdown(
  messages: ConversationExportMessage[],
  formatMessage: (message: ConversationExportMessage, index: number) => string = defaultFormatMessage
): string {
  return messages.map(function (msg, i) {
    return formatMessage(msg, i)
  }).join('\n\n')
}

function ConversationDownload({
  messages,
  filename = 'conversation.md',
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) {
  const handleDownload = useCallback(
    function () {
      const markdown = messagesToMarkdown(messages, formatMessage)
      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    },
    [messages, filename, formatMessage]
  )

  return (
    <Button
      type="button"
      className={cn(
        'absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted',
        className
      )}
      onClick={handleDownload}
      size="icon"
      variant="outline"
      data-slot="conversation-download"
      {...props}>
      {children ?? (
        <Icon
          icon="lucide:download"
          className="size-4"
        />
      )}
    </Button>
  )
}

export {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
  messagesToMarkdown
}
export type {
  ConversationExportMessage,
  ConversationProps
}
