/**
 * 用户消息里的图片区（对齐 assistant-ui `elements/image-gallery`）。
 *
 * 解决两件事：
 * 1. **多图**：一张一张竖着铺会把气泡拉成一条长卷（外面还有 264px 的封顶）——
 *    这里切成方格网格，最多先露 `maxVisible` 张，第 N 张上叠 `+N`，点开展开全部；
 * 2. **圆角**：每格 `rounded-xl` + `object-cover`，单图也走同一套圆角，
 *    不再跟着 `Image` 元素的 `rounded-lg` + 原始比例各长各的样。
 *
 * 点击看大图仍复用 `ImageZoom`（Esc 关闭、焦点回位都是它已经做好的），
 * 只是把触发器换成了网格格子。
 */
import { cn } from 'cn'
import type { ComponentProps } from 'react'
import { useState } from 'react'

import { ImageZoom } from './image'
import { useAssistantLabels } from './labels'

/** 一张图是什么：`Image` 元素与 assistant-ui 的 image part 都长这样 */
interface GalleryImage {
  src: string
  filename?: string
}

interface MessageImageGalleryProps extends Omit<ComponentProps<'div'>, 'children'> {
  images: readonly GalleryImage[]
  /** 收起时最多露几格；超过的部分塞进最后一格的 `+N` */
  maxVisible?: number
}

/** 格子：方、圆角、裁切；悬停微放大，键盘焦点有一圈 ring */
const TILE_CLASS = cn(
  'group relative block size-full overflow-hidden rounded-xl bg-foreground/[0.04]',
  'outline-none transition-transform duration-150 hover:scale-[1.01] active:scale-[0.98]',
  'focus-visible:ring-foreground/30 focus-visible:ring-1 motion-reduce:transition-none'
)

function MessageImageGallery({
  images,
  maxVisible = 4,
  className,
  ...props
}: MessageImageGalleryProps) {
  const labels = useAssistantLabels()
  const [expanded, setExpanded] = useState(false)

  if (images.length === 0) return null

  // 单图不切格：保留原始比例，只统一圆角与高度上限
  if (images.length === 1) {
    const only = images[0]
    return (
      <div
        data-slot="message-image-gallery"
        data-count="1"
        className={cn('mt-1 w-fit max-w-full', className)}
        {...props}>
        <ImageZoom src={only.src} alt={only.filename ?? labels.imageContent}>
          <img
            src={only.src}
            alt={only.filename ?? labels.imageContent}
            loading="lazy"
            className="block max-h-64 w-auto max-w-full rounded-xl object-contain"
          />
        </ImageZoom>
      </div>
    )
  }

  const limit = Math.max(2, maxVisible)
  const overflow = images.length > limit
  const shown = expanded || !overflow ? images : images.slice(0, limit)
  const hidden = images.length - shown.length

  return (
    <div
      data-slot="message-image-gallery"
      data-count={images.length}
      data-expanded={expanded ? '' : undefined}
      className={cn('mt-1 flex w-full flex-col gap-1.5', className)}
      {...props}>
      <div
        data-slot="message-image-gallery-grid"
        className={cn(
          'grid w-full gap-1.5',
          'max-w-[min(100%,22rem)]',
          // 两张并排更好看；三张起用三列，行数少一半
          images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
        )}>
        {shown.map(function (image, index) {
          const isLast = index === shown.length - 1
          const remaining = isLast ? hidden : 0
          const alt = image.filename ?? labels.imageContent

          if (remaining > 0) {
            return (
              <button
                key={image.src + index}
                type="button"
                data-slot="message-image-gallery-more"
                aria-label={labels.imageGalleryMoreLabel(remaining)}
                title={labels.imageGalleryMoreLabel(remaining)}
                onClick={function () {
                  setExpanded(true)
                }}
                className={cn(TILE_CLASS, 'cursor-pointer')}>
                <img
                  src={image.src}
                  alt={alt}
                  loading="lazy"
                  className="size-full object-cover"
                />
                <span
                  aria-hidden
                  className="bg-foreground/55 text-background absolute inset-0 flex items-center justify-center text-base font-medium">
                  {labels.imageGalleryMore(remaining)}
                </span>
              </button>
            )
          }

          return (
            <div
              key={image.src + index}
              data-slot="message-image-gallery-tile"
              className="aspect-square">
              <ImageZoom src={image.src} alt={alt}>
                <img
                  src={image.src}
                  alt={alt}
                  loading="lazy"
                  className={cn(TILE_CLASS, 'object-cover')}
                />
              </ImageZoom>
            </div>
          )
        })}
      </div>

      {expanded && overflow ? (
        <button
          type="button"
          data-slot="message-image-gallery-collapse"
          onClick={function () {
            setExpanded(false)
          }}
          className="text-muted-foreground hover:text-foreground w-fit rounded-md px-1 text-xs transition-colors">
          {labels.imageGalleryCollapse}
        </button>
      ) : null}
    </div>
  )
}

export { MessageImageGallery }
export type { GalleryImage, MessageImageGalleryProps }