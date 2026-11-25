import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react'
import { memo, useState } from 'react'
import { originalUrlFor, pickBucket, thumbUrlFor } from '@/views/gallery/data/thumb-url'
import type { GalleryRow } from '@/views/gallery/model/asset'
import { formatDuration } from '@/views/gallery/model/derive'

/**
 * 网格单元：`role="option"` + 缩略图 + 角标。
 *
 * `Button` 自带 `h-8`，所以要 `size-full` + `p-0` 覆盖掉 —— 目标不是按钮尺寸，
 * 而是「铺满格子的可点击区域」；`variant="ghost"` 让 hover 不自带底色（由环形高亮表达选中）。
 * 图片一律走 `thumb://`，只有解码失败才回落原图（HEIC/RAW 由后端 FFmpeg 兜底，见 D17）。
 */
interface GalleryCellProps {
  row: GalleryRow
  columns: number
  isSelected: boolean
  isActive: boolean
  /** 选择模式：显示勾选圈，鼠标悬停就能看出来“这一格可以点” */
  isSelecting: boolean
  onActivate: (row: GalleryRow, options: { additive: boolean; range: boolean }) => void
  onOpen: (row: GalleryRow) => void
}

const LABEL_COLORS: Record<string, string> = {
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7'
}

function GalleryCellBase(props: GalleryCellProps) {
  const row = props.row
  const duration = formatDuration(row.durationMs)
  const isVideo = row.kind === 'video'
  // src 从 props 现算，不用 state 存：
  // - 列数变了 = 桶变了，必须换 URL；
  // - 文件被覆盖/改名后 mtime 变了，URL 也必须跟着变（否则一直显示旧图）。
  // 只把「哪个 URL 曾经失败」记下来，这样 URL 一换就自动重试。
  const thumb = thumbUrlFor(row, pickBucket(props.columns))
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [isFrameBroken, updateFrameBroken] = useState(false)
  const isThumbFailed = failedSrc === thumb
  // 视频不能把 mp4 塞进 `<img>`：浏览器按图片解码必然失败，格子会永远空着（还白下载一份原片）。
  // 缩略图解码失败（slim 包不带 FFmpeg、或编码解不开）时改让 `<video>` 自己停在首帧。
  const showVideoFrame = isVideo && isThumbFailed && !isFrameBroken
  const src = isThumbFailed ? (isVideo ? null : originalUrlFor(row)) : thumb

  return (
    <Button
      variant="ghost"
      role="option"
      aria-selected={props.isSelected}
      data-gallery-cell={row.id}
      className={[
        'group relative block size-full overflow-hidden rounded-md p-0 hover:bg-transparent',
        'bg-muted/40 ring-1 ring-transparent transition-shadow',
        'hover:ring-1 hover:ring-border',
        props.isSelected ? 'ring-2 ring-primary hover:ring-2 hover:ring-primary' : '',
        props.isActive ? 'ring-2 ring-ring' : ''
      ].join(' ')}
      onClick={function (event) {
        props.onActivate(row, { additive: event.metaKey || event.ctrlKey, range: event.shiftKey })
      }}
      onDoubleClick={function () {
        props.onOpen(row)
      }}
    >
      {/* 兜底图标：媒体还没加载出来 / 解码失败时，至少能看出格子里是什么，而不是一块空灰 */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground/60">
        <Icon
          icon={isVideo ? 'lucide:film' : 'lucide:image-off'}
          className="size-6"
        />
      </div>

      {showVideoFrame ? (
        <video
          src={`${originalUrlFor(row)}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-hidden
          className="relative size-full object-cover"
          onError={function () {
            updateFrameBroken(true)
          }}
        />
      ) : src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="relative size-full object-cover"
          onError={function () {
            setFailedSrc(thumb)
          }}
        />
      ) : null}

      {/* 顶部：勾选圈 / 星级 / 组标记 / 颜色 */}
      <div className="pointer-events-none absolute inset-x-1 top-1 flex items-start justify-between gap-1">
        <div className="flex items-center gap-1">
          {props.isSelecting ? (
            <span
              className={[
                'flex size-3.5 items-center justify-center rounded-full border transition-opacity',
                'border-white/80 bg-black/35',
                props.isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              ].join(' ')}
            >
              {props.isSelected ? <Icon icon="lucide:check" className="size-2.5 text-white" /> : null}
            </span>
          ) : null}
          {row.rating > 0 ? (
            <span className="rounded bg-black/55 px-1 text-[10px] leading-4 text-white">
              {'★'.repeat(Math.min(row.rating, 5))}
            </span>
          ) : null}
          {row.stackID ? (
            <span className="rounded bg-black/55 px-1 text-[10px] leading-4 text-white">
              <Icon icon="lucide:layers" className="inline size-3" />
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {row.flag === 'rejected' ? (
            <span className="rounded bg-destructive px-1 text-[10px] leading-4 text-white">
              <Icon icon="lucide:ban" className="inline size-3" />
            </span>
          ) : null}
          {row.label ? (
            <span
              className="size-2.5 rounded-full ring-1 ring-white/70"
              style={{ backgroundColor: LABEL_COLORS[row.label] ?? '#888' }}
            />
          ) : null}
        </div>
      </div>

      {/* 底部：时长 / 位置失效 */}
      <div className="pointer-events-none absolute inset-x-1 bottom-1 flex items-end justify-between gap-1">
        <div>
          {row.missing ? (
            <span className="rounded bg-amber-600/85 px-1 text-[10px] leading-4 text-white">
              位置失效
            </span>
          ) : null}
        </div>
        <div>
          {duration ? (
            <span className="rounded bg-black/55 px-1 text-[10px] leading-4 tabular-nums text-white">
              {duration}
            </span>
          ) : null}
        </div>
      </div>
    </Button>
  )
}

/** `memo`：改星级/选中只会替换命中的行对象，其余单元不必重渲染。 */
const GalleryCell = memo(GalleryCellBase)
export { GalleryCell, LABEL_COLORS }
export type { GalleryCellProps }
