import { findComponentLabel, findTileHint } from '@/constants/marketplace/tile-hints'
import { buildSurfaceStyle } from '@/features/magnetic-tile/surface-style'
import { TEXT_COLOR } from '@/views/marketplace/workspace/customize/colors.ts'
import {
  parseBackgroundImage,
  parseBackdrop,
  PREVIEW_TITLE_PLACEHOLDER,
  PREVIEW_URL_PLACEHOLDER,
  IMAGE_NONE,
  OPACITY_DEFAULT,
  type FormValues,
  type PicsumImage
} from '@/views/marketplace/workspace/customize/form'

interface PreviewProps {
  watched: Partial<FormValues>
  images: PicsumImage[]
  fallbackColor: string
  keptImageUrl: string | null
  component: MagneticTile.Component
}

function Preview(props: PreviewProps) {
  const title = props.watched.title?.trim() || PREVIEW_TITLE_PLACEHOLDER
  const color = props.watched.color || props.fallbackColor
  const textColor = props.watched.textColor || TEXT_COLOR
  const imageUrl = parseBackgroundImage(
    { image: props.watched.image || IMAGE_NONE },
    props.images,
    props.keptImageUrl
  )
  const subtitle =
    props.component === 'navigation'
      ? props.watched.url?.trim() || PREVIEW_URL_PLACEHOLDER
      : findTileHint(props.component, findComponentLabel(props.component))

  const surfaceStyle = buildSurfaceStyle({
    round: '12px',
    textColor,
    background: {
      color,
      image: imageUrl,
      size: 'cover',
      position: 'center'
    },
    backdrop: parseBackdrop(
      props.watched.backdropBlur ?? 0,
      props.watched.backdropOpacity ?? OPACITY_DEFAULT
    )
  })

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-3 self-stretch">
      <div
        className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-cover bg-center bg-no-repeat transition-colors"
        style={surfaceStyle}>
        <div className="absolute inset-0 flex flex-col justify-end bg-linear-to-t from-black/60 via-black/10 to-transparent px-5 py-4">
          <p
            className="text-xl leading-snug font-semibold"
            style={{ color: textColor }}>
            {title}
          </p>
          <p
            className="mt-1 truncate text-sm"
            style={{ color: textColor, opacity: 0.85 }}>
            {subtitle}
          </p>
        </div>
      </div>
    </div>
  )
}

export type { PreviewProps }
export { Preview }
