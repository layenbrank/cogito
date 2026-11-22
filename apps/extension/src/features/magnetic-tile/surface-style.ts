import type { CSSProperties } from 'react'

import { generateRamp, normalizeHex } from '@/utils/color'

interface SurfaceStyleInput {
  round?: string | null
  background?: MagneticTile.Background | null
  backdrop?: MagneticTile.Backdrop | null
  textColor?: string | null
}

type SurfaceCss = CSSProperties & Record<`--${string}`, string>

function parseBackdropFilter(backdrop: MagneticTile.Backdrop | null | undefined) {
  if (!backdrop) return undefined

  const parts: string[] = []
  if (backdrop.blur) parts.push(`blur(${backdrop.blur})`)
  if (backdrop.brightness) parts.push(`brightness(${backdrop.brightness})`)
  if (backdrop.contrast) parts.push(`contrast(${backdrop.contrast})`)
  if (backdrop.grayscale) parts.push(`grayscale(${backdrop.grayscale})`)
  if (backdrop.hueRotate) parts.push(`hue-rotate(${backdrop.hueRotate})`)
  if (backdrop.opacity) parts.push(`opacity(${backdrop.opacity})`)
  if (backdrop.saturate) parts.push(`saturate(${backdrop.saturate})`)
  if (backdrop.sepia) parts.push(`sepia(${backdrop.sepia})`)
  if (backdrop.dropShadow) parts.push(`drop-shadow(${backdrop.dropShadow})`)

  if (parts.length === 0) return undefined
  return parts.join(' ')
}

/** 磁贴油墨色：兼容库内缺 `#` 的 hex，避免内联 color 被浏览器丢弃 */
function parseInk(textColor: string | null | undefined) {
  if (!textColor) return undefined
  const trimmed = textColor.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('#') || trimmed.startsWith('rgb') || trimmed.startsWith('hsl')) {
    return trimmed.startsWith('#') ? normalizeHex(trimmed) : trimmed
  }
  if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return normalizeHex(trimmed)
  }
  return trimmed
}

/**
 * 将磁贴 round / background / backdrop / textColor 组装为内层 surface 内联样式。
 * 主窗 MagneticTile.Section 与浮层 Overlay Tile 共用。
 */
function buildSurfaceStyle(input: SurfaceStyleInput = {}): CSSProperties {
  const round = input.round
  const size = input.background?.size
  const clip = input.background?.clip
  const color = input.background?.color
  const image = input.background?.image
  const origin = input.background?.origin
  const repeat = input.background?.repeat
  const position = input.background?.position
  const blendMode = input.background?.blendMode
  const attachment = input.background?.attachment
  const backdropFilter = parseBackdropFilter(input.backdrop)
  const ink = parseInk(input.textColor)

  const backgroundImage = image ? `url(${image})` : undefined
  // 未指定颜色时落到 `--card`：写死白底会在暗色主题下与浅色文字互相吃掉
  const backgroundColor = image ? undefined : (color ?? 'var(--card)')

  const style: SurfaceCss = {
    backgroundSize: size ?? 'cover',
    backgroundColor,
    backgroundImage,
    '--magnetic-tile-round': round ?? '12px',
    backgroundRepeat: repeat ?? 'no-repeat',
    backgroundPosition: position ?? 'center',
    backgroundAttachment: attachment ?? 'scroll'
  }

  if (clip) style.backgroundClip = clip
  if (origin) style.backgroundOrigin = origin
  if (blendMode) style.backgroundBlendMode = blendMode
  if (ink) {
    style.color = ink
    style['--magnetic-tile-ink'] = ink
  }
  if (backdropFilter) {
    style.backdropFilter = backdropFilter
    style.WebkitBackdropFilter = backdropFilter
  }

  return style
}

function paintPrimary(color: string) {
  return generateRamp(color)
}

export { buildSurfaceStyle, paintPrimary }
export type { SurfaceStyleInput }
