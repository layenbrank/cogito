import { Icon } from '@iconify/react/offline'
import { type FC, type ReactNode } from 'react'
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAuiState,
  useAui,
  type Attachment
} from '@assistant-ui/react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip'
import { Avatar, AvatarImage, AvatarFallback } from '../components/avatar'
import { useAttachmentSrc } from '../hooks/use-attachment-src'
import { useAttachmentLightboxMedias } from '../hooks/use-attachment-lightbox-medias'
import { TooltipIconButton } from './tooltip-icon-button'
import { useAssistantLabels } from './labels'
import { findBaseName, findFileNameIcon } from './file-name-icon'
import {
  AttachmentLightboxProvider,
  useAttachmentLightbox
} from './attachment-lightbox'
import { cn } from 'cn'

const AttachmentThumb: FC = () => {
  const labels = useAssistantLabels()
  const src = useAttachmentSrc()
  const fileName = useAuiState(function (state) {
    return state.attachment.name || 'file'
  })
  const hint = findFileNameIcon(fileName)

  return (
    // `after:hidden`：Avatar 自带的圆环遮罩是给头像用的，缩略图上会和瓦片自己的 ring 叠成双框
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none after:hidden">
      <AvatarImage
        src={src}
        alt={labels.attachmentPreview}
        className="aui-attachment-tile-image rounded-none object-cover"
      />
      <AvatarFallback className="bg-muted/80 rounded-none">
        <Icon
          icon={hint.icon}
          className={cn('aui-attachment-tile-fallback-icon size-6 stroke-[1.5]', hint.className)}
        />
      </AvatarFallback>
    </Avatar>
  )
}

/** 非图片附件：路径芯片 + 按扩展名着色的文件图标 */
const AttachmentFileChip: FC = () => {
  const labels = useAssistantLabels()
  const aui = useAui()
  const isComposer = aui.attachment.source !== 'message'
  const name = useAuiState(function (state) {
    return state.attachment.name || 'file'
  })
  const typeLabel = useAuiState(function (state) {
    return labels.attachmentType(state.attachment.type)
  })
  const uploadState = useAuiState(function (state) {
    return state.attachment.status.type === 'running'
      ? 'uploading'
      : state.attachment.status.type === 'incomplete' && state.attachment.status.reason === 'error'
        ? 'error'
        : undefined
  })
  const isUploading = uploadState === 'uploading'
  const isError = uploadState === 'error'
  const hint = findFileNameIcon(name)
  const baseName = findBaseName(name)

  return (
    <TooltipProvider>
      <Tooltip>
        <AttachmentPrimitive.Root
          className={cn(
            'aui-attachment-root aui-attachment-file-chip relative',
            isComposer && 'animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none'
          )}>
          <TooltipTrigger
            render={
              <div
                className={cn(
                  'border-input bg-muted/50 hover:bg-muted flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border py-0.5 ps-2',
                  isComposer ? 'pe-1' : 'pe-2.5',
                  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isError && 'border-destructive/50'
                )}
                role="button"
                tabIndex={0}
                aria-label={labels.attachmentLabel(
                  typeLabel,
                  isError ? 'error' : isUploading ? 'uploading' : 'idle'
                )}
              />
            }>
            {isUploading ? (
              <Icon
                icon="lucide:loader-circle"
                className="text-muted-foreground size-3.5 shrink-0 animate-spin"
              />
            ) : isError ? (
              <Icon
                icon="lucide:circle-alert"
                className="text-destructive size-3.5 shrink-0"
              />
            ) : (
              <Icon
                icon={hint.icon}
                className={cn('size-3.5 shrink-0', hint.className)}
              />
            )}
            <span
              className="text-foreground min-w-0 flex-1 truncate text-xs"
              title={name}>
              {baseName}
            </span>
            {isComposer ? <AttachmentChipRemove /> : null}
          </TooltipTrigger>
        </AttachmentPrimitive.Root>
        <TooltipContent side="top">
          <AttachmentPrimitive.Name />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const AttachmentImageTile: FC = () => {
  const labels = useAssistantLabels()
  const aui = useAui()
  const lightbox = useAttachmentLightbox()
  const isComposer = aui.attachment.source !== 'message'
  const attachmentId = useAuiState(function (state) {
    return state.attachment.id
  })
  const typeLabel = useAuiState(function (state) {
    return labels.attachmentType(state.attachment.type)
  })

  const uploadState = useAuiState(function (state) {
    return state.attachment.status.type === 'running'
      ? 'uploading'
      : state.attachment.status.type === 'incomplete' && state.attachment.status.reason === 'error'
        ? 'error'
        : undefined
  })
  const isUploading = uploadState === 'uploading'
  const isError = uploadState === 'error'

  const errorMessage = useAuiState(function (state) {
    return state.attachment.status.type === 'incomplete' &&
      state.attachment.status.reason === 'error'
      ? (state.attachment.status.message ?? labels.uploadFailed)
      : undefined
  })

  const src = useAttachmentSrc()
  const canPreview = Boolean(src) && !isUploading && !isError

  return (
    <TooltipProvider>
      <Tooltip>
        <AttachmentPrimitive.Root
          className={cn(
            'aui-attachment-root relative',
            isComposer && 'animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none',
            !isComposer && 'aui-attachment-root-message only:*:first:size-24'
          )}>
          <TooltipTrigger
            render={
              <div
                className={cn(
                  'aui-attachment-tile bg-muted hover:after:bg-foreground/10 active:after:bg-foreground/20 focus-visible:ring-ring/50 relative size-14 shrink-0 overflow-hidden rounded-[calc(var(--composer-radius,1.5rem)-var(--composer-padding,8px))] outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-black/10 after:transition-colors after:ring-inset focus-visible:ring-1 motion-reduce:transition-none dark:after:ring-white/10',
                  canPreview ? 'cursor-zoom-in' : 'cursor-default',
                  isError && 'after:ring-destructive/60 dark:after:ring-destructive/60'
                )}
                role="button"
                tabIndex={0}
                aria-label={labels.attachmentLabel(
                  typeLabel,
                  isError ? 'error' : isUploading ? 'uploading' : 'idle'
                )}
                onClick={function () {
                  if (!canPreview || !lightbox) return
                  lightbox.open(attachmentId)
                }}
                onKeyDown={function (event) {
                  if (!canPreview || !lightbox) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    lightbox.open(attachmentId)
                  }
                }}
              />
            }>
            <AttachmentThumb />
            {isUploading ? (
              <div
                aria-hidden="true"
                className="aui-attachment-tile-uploading bg-background/60 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none">
                <Icon
                  icon="lucide:loader-circle"
                  className="text-muted-foreground size-4 animate-spin"
                />
              </div>
            ) : null}
            {isError ? (
              <div
                aria-hidden="true"
                className="aui-attachment-tile-error bg-background/70 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none">
                <Icon
                  icon="lucide:circle-alert"
                  className="text-destructive size-4"
                />
              </div>
            ) : null}
          </TooltipTrigger>
          {isComposer ? <AttachmentTileRemove /> : null}
        </AttachmentPrimitive.Root>
        <TooltipContent side="top">
          <AttachmentPrimitive.Name />
          {errorMessage ? <p className="aui-attachment-error-message">{errorMessage}</p> : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const AttachmentUI: FC = () => {
  const isImage = useAuiState(function (state) {
    return state.attachment.type === 'image'
  })
  if (!isImage) return <AttachmentFileChip />
  return <AttachmentImageTile />
}

const AttachmentTileRemove: FC = () => {
  const labels = useAssistantLabels()

  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip={labels.removeAttachment}
        className="aui-attachment-tile-remove absolute end-1 top-1 size-5 rounded-full bg-black/50! text-white after:absolute after:-inset-1.5 hover:bg-black/70! hover:text-white! active:bg-black/80! motion-reduce:transition-none"
        side="top">
        <Icon
          icon="lucide:x"
          className="aui-attachment-remove-icon size-3 stroke-[2.5]"
        />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  )
}

const AttachmentChipRemove: FC = () => {
  const labels = useAssistantLabels()

  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip={labels.removeAttachment}
        className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 size-5 shrink-0 rounded-full"
        side="top">
        <Icon
          icon="lucide:x"
          className="size-3 stroke-[2.5]"
        />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  )
}

function AttachmentStrip(props: {
  attachments: readonly Attachment[]
  className: string
  children: ReactNode
}) {
  const medias = useAttachmentLightboxMedias(props.attachments)
  return (
    <AttachmentLightboxProvider medias={medias}>
      <div className={props.className}>{props.children}</div>
    </AttachmentLightboxProvider>
  )
}

export const UserMessageAttachments: FC = () => {
  const attachments = useAuiState(function (state) {
    return state.message.attachments ?? []
  })

  if (attachments.length === 0) return null

  return (
    <AttachmentStrip
      attachments={attachments}
      className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments>{function () {
        return <AttachmentUI />
      }}</MessagePrimitive.Attachments>
    </AttachmentStrip>
  )
}

export const ComposerAttachments: FC = () => {
  const attachments = useAuiState(function (state) {
    return state.composer.attachments
  })

  if (attachments.length === 0) return null

  return (
    <AttachmentStrip
      attachments={attachments}
      className="aui-composer-attachments flex w-full min-w-0 flex-row flex-wrap items-center gap-1.5 overflow-hidden">
      <ComposerPrimitive.Attachments>{function () {
        return <AttachmentUI />
      }}</ComposerPrimitive.Attachments>
    </AttachmentStrip>
  )
}

export const ComposerAddAttachment: FC = () => {
  const labels = useAssistantLabels()

  return (
    <ComposerPrimitive.AddAttachment asChild>
      <TooltipIconButton
        tooltip={labels.addAttachment}
        side="bottom"
        variant="ghost"
        size="icon"
        className="aui-composer-add-attachment text-muted-foreground hover:text-foreground hover:bg-muted-foreground/15 active:bg-muted-foreground/25 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 size-7 rounded-md motion-reduce:transition-none"
        aria-label={labels.addAttachment}>
        <Icon
          icon="lucide:plus"
          className="aui-attachment-add-icon size-4"
        />
      </TooltipIconButton>
    </ComposerPrimitive.AddAttachment>
  )
}
