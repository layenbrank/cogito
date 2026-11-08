import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo } from 'react'

import { Button } from '../components/button'
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover'

type AttachmentFilePart = {
  type: 'file'
  id: string
  url?: string
  filename?: string
  mediaType?: string
}

type AttachmentSourcePart = {
  type: 'source-document'
  id: string
  title?: string
  filename?: string
  mediaType?: string
}

type AttachmentData = AttachmentFilePart | AttachmentSourcePart

type AttachmentMediaCategory = 'image' | 'video' | 'audio' | 'document' | 'source' | 'unknown'

type AttachmentVariant = 'grid' | 'inline' | 'list'

const MEDIA_CATEGORY_ICONS: Record<AttachmentMediaCategory, string> = {
  audio: 'lucide:music-2',
  document: 'lucide:file-text',
  image: 'lucide:image',
  source: 'lucide:globe',
  unknown: 'lucide:paperclip',
  video: 'lucide:video'
}

function findMediaCategory(data: AttachmentData): AttachmentMediaCategory {
  if (data.type === 'source-document') return 'source'
  const mediaType = data.mediaType ?? ''
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType.startsWith('video/')) return 'video'
  if (mediaType.startsWith('audio/')) return 'audio'
  if (mediaType.startsWith('application/') || mediaType.startsWith('text/')) return 'document'
  return 'unknown'
}

function findAttachmentLabel(data: AttachmentData): string {
  if (data.type === 'source-document') {
    return data.title || data.filename || 'Source'
  }
  const category = findMediaCategory(data)
  return data.filename || (category === 'image' ? 'Image' : 'Attachment')
}

interface AttachmentsContextValue {
  variant: AttachmentVariant
}

const AttachmentsContext = createContext<AttachmentsContextValue | null>(null)

interface AttachmentContextValue {
  data: AttachmentData
  mediaCategory: AttachmentMediaCategory
  onRemove?: () => void
  variant: AttachmentVariant
}

const AttachmentItemContext = createContext<AttachmentContextValue | null>(null)

function useAttachmentsContext() {
  return useContext(AttachmentsContext) ?? { variant: 'grid' as const }
}

function useAttachmentContext() {
  const ctx = useContext(AttachmentItemContext)
  if (!ctx) {
    throw new Error('Attachment components must be used within Attachment')
  }
  return ctx
}

type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  variant?: AttachmentVariant
}

function Attachments({ variant = 'grid', className, children, ...props }: AttachmentsProps) {
  const contextValue = useMemo(
    function () {
      return { variant }
    },
    [variant]
  )

  return (
    <AttachmentsContext.Provider value={contextValue}>
      <div
        data-slot="attachments"
        className={cn(
          'flex items-start',
          variant === 'list' ? 'flex-col gap-2' : 'flex-wrap gap-2',
          variant === 'grid' && 'ml-auto w-fit',
          className
        )}
        {...props}>
        {children}
      </div>
    </AttachmentsContext.Provider>
  )
}

type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData
  onRemove?: () => void
}

function Attachment({ data, onRemove, className, children, ...props }: AttachmentProps) {
  const { variant } = useAttachmentsContext()
  const mediaCategory = findMediaCategory(data)

  const contextValue = useMemo(
    function () {
      return { data, mediaCategory, onRemove, variant }
    },
    [data, mediaCategory, onRemove, variant]
  )

  return (
    <AttachmentItemContext.Provider value={contextValue}>
      <div
        data-slot="attachment"
        className={cn(
          'group relative',
          variant === 'grid' && 'size-24 overflow-hidden rounded-lg',
          variant === 'inline' && [
            'border-border flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-1.5',
            'text-sm font-medium transition-all select-none',
            'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50'
          ],
          variant === 'list' && [
            'flex w-full items-center gap-3 rounded-lg border p-3',
            'hover:bg-accent/50'
          ],
          className
        )}
        {...props}>
        {children}
      </div>
    </AttachmentItemContext.Provider>
  )
}

type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement> & {
  fallbackIcon?: ReactNode
}

function AttachmentPreview({ fallbackIcon, className, ...props }: AttachmentPreviewProps) {
  const { data, mediaCategory, variant } = useAttachmentContext()
  const iconSize = variant === 'inline' ? 'size-3' : 'size-4'

  function renderIcon(icon: string) {
    return (
      <Icon
        icon={icon}
        className={cn(iconSize, 'text-muted-foreground')}
      />
    )
  }

  function renderContent() {
    if (mediaCategory === 'image' && data.type === 'file' && data.url) {
      return variant === 'grid' ? (
        <img
          alt={data.filename || 'Image'}
          className="size-full object-cover"
          height={96}
          src={data.url}
          width={96}
        />
      ) : (
        <img
          alt={data.filename || 'Image'}
          className="size-full rounded object-cover"
          height={20}
          src={data.url}
          width={20}
        />
      )
    }

    if (mediaCategory === 'video' && data.type === 'file' && data.url) {
      return (
        <video
          className="size-full object-cover"
          muted
          src={data.url}
        />
      )
    }

    const icon = MEDIA_CATEGORY_ICONS[mediaCategory]
    return fallbackIcon ?? renderIcon(icon)
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden',
        variant === 'grid' && 'bg-muted size-full',
        variant === 'inline' && 'bg-background size-5 rounded',
        variant === 'list' && 'bg-muted size-12 rounded',
        className
      )}
      {...props}>
      {renderContent()}
    </div>
  )
}

type AttachmentInfoProps = HTMLAttributes<HTMLDivElement> & {
  showMediaType?: boolean
}

function AttachmentInfo({ showMediaType = false, className, ...props }: AttachmentInfoProps) {
  const { data, variant } = useAttachmentContext()
  const label = findAttachmentLabel(data)

  if (variant === 'grid') return null

  return (
    <div
      className={cn('min-w-0 flex-1', className)}
      {...props}>
      <span className="block truncate">{label}</span>
      {showMediaType && data.mediaType ? (
        <span className="text-muted-foreground block truncate text-xs">{data.mediaType}</span>
      ) : null}
    </div>
  )
}

type AttachmentRemoveProps = ComponentProps<typeof Button> & {
  label?: string
}

function AttachmentRemove({
  label = 'Remove',
  className,
  children,
  ...props
}: AttachmentRemoveProps) {
  const { onRemove, variant } = useAttachmentContext()

  const handleClick = useCallback(
    function (event: React.MouseEvent) {
      event.stopPropagation()
      onRemove?.()
    },
    [onRemove]
  )

  if (!onRemove) return null

  return (
    <Button
      type="button"
      aria-label={label}
      variant="ghost"
      onClick={handleClick}
      className={cn(
        variant === 'grid' && [
          'bg-background/80 absolute top-2 right-2 size-6 rounded-full p-0 backdrop-blur-sm',
          'opacity-0 transition-opacity group-hover:opacity-100',
          'hover:bg-background',
          '[&>svg]:size-3'
        ],
        variant === 'inline' && [
          'size-5 rounded p-0',
          'opacity-0 transition-opacity group-hover:opacity-100',
          '[&>svg]:size-2.5'
        ],
        variant === 'list' && ['size-8 shrink-0 rounded p-0', '[&>svg]:size-4'],
        className
      )}
      {...props}>
      {children ?? (
        <Icon
          icon="lucide:x"
          className="size-3.5"
        />
      )}
      <span className="sr-only">{label}</span>
    </Button>
  )
}

type AttachmentHoverCardProps = ComponentProps<typeof Popover>

function AttachmentHoverCard(props: AttachmentHoverCardProps) {
  return (
    <Popover
      data-slot="attachment-hover-card"
      {...props}
    />
  )
}

type AttachmentHoverCardTriggerProps = ComponentProps<typeof PopoverTrigger>

function AttachmentHoverCardTrigger(props: AttachmentHoverCardTriggerProps) {
  return (
    <PopoverTrigger
      data-slot="attachment-hover-card-trigger"
      {...props}
    />
  )
}

type AttachmentHoverCardContentProps = ComponentProps<typeof PopoverContent>

function AttachmentHoverCardContent({
  align = 'start',
  className,
  ...props
}: AttachmentHoverCardContentProps) {
  return (
    <PopoverContent
      align={align}
      className={cn('w-auto p-2', className)}
      {...props}
    />
  )
}

type AttachmentEmptyProps = HTMLAttributes<HTMLDivElement>

function AttachmentEmpty({ className, children, ...props }: AttachmentEmptyProps) {
  return (
    <div
      className={cn(
        'text-muted-foreground flex items-center justify-center p-4 text-sm',
        className
      )}
      {...props}>
      {children ?? 'No attachments'}
    </div>
  )
}

export {
  Attachment,
  AttachmentEmpty,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  findAttachmentLabel,
  findMediaCategory
}
export type {
  AttachmentData,
  AttachmentFilePart,
  AttachmentMediaCategory,
  AttachmentSourcePart,
  AttachmentVariant
}
