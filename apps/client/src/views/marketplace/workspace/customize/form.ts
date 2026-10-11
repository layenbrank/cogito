import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import {
  findShade,
  TEXT_COLOR
} from '@/views/marketplace/workspace/customize/colors.ts'
import type { MagneticTileWrite } from '@/stores/mirror.ts'

interface PicsumImage {
  id: string
  seed?: string
}

interface FormValues {
  title: string
  url: string
  color: string
  image: string
  textColor: string
  backdropBlur: number
  backdropOpacity: number
}

interface TileOption {
  value: string
  label: string
  description?: string
}

type TileSelectOption = TileOption | { label: string; options: TileOption[] }

const PICSUM_BASE = 'https://picsum.photos'
const PICSUM_LIMIT = 12
const PICSUM_THUMB_WIDTH = 160
const PICSUM_THUMB_HEIGHT = 90
const PICSUM_PREVIEW_WIDTH = 800
const PICSUM_PREVIEW_HEIGHT = 450
const SWATCH_SIZE_CLASS = 'size-11'
const PRESET_SWATCH_CLASS = 'size-6'
const IMAGE_SWATCH_CLASS = 'h-18 w-32'
const PREVIEW_TITLE_PLACEHOLDER = '未命名应用'
const PREVIEW_URL_PLACEHOLDER = '请输入链接预览'
const CREATE_KEY = '__create__'
const IMAGE_NONE = '__none__'
const BLUR_MAX = 24
const OPACITY_DEFAULT = 1

function buildPicsumUrl(image: PicsumImage, width: number, height: number) {
  if (image.seed) {
    return `${PICSUM_BASE}/seed/${image.seed}/${width}/${height}`
  }

  return `${PICSUM_BASE}/id/${image.id}/${width}/${height}`
}

function findPicsumImage(images: PicsumImage[], imageId: string | undefined) {
  if (!imageId) return undefined
  return images.find(function (item) {
    return item.id === imageId
  })
}

function findPicsumIdFromUrl(url: string | undefined, images: PicsumImage[]) {
  if (!url) return undefined

  const idMatch = url.match(/\/id\/([^/]+)\//)
  if (idMatch) {
    const id = idMatch[1]
    if (
      images.some(function (image) {
        return image.id === id
      })
    ) {
      return id
    }
  }

  const seedMatch = url.match(/\/seed\/([^/]+)\//)
  if (seedMatch) {
    const seed = seedMatch[1]
    const found = images.find(function (image) {
      return image.seed === seed
    })
    if (found) return found.id
  }

  return undefined
}

function parseCssNumber(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const matched = String(value).match(/([\d.]+)/)
  if (!matched) return fallback
  const parsed = Number(matched[1])
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseBackdrop(blur: number, opacity: number): MagneticTile.Backdrop | null {
  const hasBlur = blur > 0
  const hasOpacity = opacity < OPACITY_DEFAULT
  if (!hasBlur && !hasOpacity) return null

  const backdrop: MagneticTile.Backdrop = {}
  if (hasBlur) backdrop.blur = `${blur}px`
  if (hasOpacity) backdrop.opacity = String(opacity)
  return backdrop
}

function parseBackgroundImage(
  value: Pick<FormValues, 'image'>,
  images: PicsumImage[],
  keptImageUrl: string | null
): string | undefined {
  if (value.image === IMAGE_NONE) return undefined

  const selectedImage = findPicsumImage(images, value.image)
  if (selectedImage) {
    return buildPicsumUrl(selectedImage, PICSUM_PREVIEW_WIDTH, PICSUM_PREVIEW_HEIGHT)
  }

  return keptImageUrl ?? undefined
}

function parseSurface(
  value: FormValues,
  images: PicsumImage[],
  keptImageUrl: string | null
) {
  const title = value.title.trim()
  return {
    title,
    description: title,
    textColor: value.textColor,
    background: {
      color: value.color,
      image: parseBackgroundImage(value, images, keptImageUrl),
      size: 'cover' as const,
      position: 'center' as const
    },
    backdrop: parseBackdrop(value.backdropBlur, value.backdropOpacity)
  }
}

function parseFormWrite(
  value: FormValues,
  images: PicsumImage[],
  mirrorID: string,
  index: number,
  keptImageUrl: string | null
): MagneticTileWrite {
  const surface = parseSurface(value, images, keptImageUrl)

  return {
    index,
    ...surface,
    url: value.url.trim(),
    round: '12px',
    mark: null,
    component: 'navigation',
    mirrorID,
    collectionID: null,
    size: 2,
    shape: 'rectangle',
    direction: 'horizontal'
  }
}

function parseFormChange(
  value: FormValues,
  images: PicsumImage[],
  keptImageUrl: string | null,
  canEditUrl: boolean
): MagneticTile.Change {
  const surface = parseSurface(value, images, keptImageUrl)
  if (!canEditUrl) return surface

  return {
    ...surface,
    url: value.url.trim() || null
  }
}

function findTileLabel(tile: MagneticTile) {
  return tile.title.trim() || tile.url || tile.id
}

function findTileDescription(tile: MagneticTile) {
  return tile.description.trim() || findComponentLabel(tile.component)
}

function parseTileOptions(tiles: MagneticTile[]): TileSelectOption[] {
  const navigate: TileOption[] = []
  const booth: TileOption[] = []

  for (const tile of tiles) {
    const option: TileOption = {
      value: tile.id,
      label: findTileLabel(tile),
      description: findTileDescription(tile)
    }
    if (tile.component === 'navigation') navigate.push(option)
    else booth.push(option)
  }

  return [
    { value: CREATE_KEY, label: '新建网址磁贴' },
    ...(navigate.length ? [{ label: '网址', options: navigate }] : []),
    ...(booth.length ? [{ label: '磁贴', options: booth }] : [])
  ]
}

function parseTileToForm(
  tile: MagneticTile,
  images: PicsumImage[],
  fallbackColor: string
): { values: FormValues; keptImageUrl: string | null } {
  const imageUrl = tile.background?.image ?? null
  const picsumId = findPicsumIdFromUrl(imageUrl ?? undefined, images)

  return {
    keptImageUrl: picsumId ? null : imageUrl,
    values: {
      title: tile.title,
      url: tile.url ?? '',
      color: tile.background?.color ?? fallbackColor,
      image: picsumId ?? imageUrl ?? IMAGE_NONE,
      textColor: tile.textColor ?? TEXT_COLOR,
      backdropBlur: parseCssNumber(tile.backdrop?.blur, 0),
      backdropOpacity: parseCssNumber(tile.backdrop?.opacity, OPACITY_DEFAULT)
    }
  }
}

function isUrl(value: string) {
  try {
    return Boolean(new URL(value))
  } catch {
    return false
  }
}

function buildCreateValues(
  colorShades: string[],
  textShades: string[],
  themePrimary: string
): FormValues {
  return {
    title: '',
    url: '',
    color: findShade(colorShades, themePrimary),
    image: IMAGE_NONE,
    textColor: findShade(textShades, TEXT_COLOR),
    backdropBlur: 0,
    backdropOpacity: OPACITY_DEFAULT
  }
}

function tileOptionKey(option: TileSelectOption) {
  return 'options' in option ? option.label : option.value
}

export type { FormValues, PicsumImage, TileOption, TileSelectOption }
export {
  BLUR_MAX,
  CREATE_KEY,
  IMAGE_NONE,
  IMAGE_SWATCH_CLASS,
  OPACITY_DEFAULT,
  PICSUM_LIMIT,
  PICSUM_PREVIEW_HEIGHT,
  PICSUM_PREVIEW_WIDTH,
  PICSUM_THUMB_HEIGHT,
  PICSUM_THUMB_WIDTH,
  PRESET_SWATCH_CLASS,
  PREVIEW_TITLE_PLACEHOLDER,
  PREVIEW_URL_PLACEHOLDER,
  SWATCH_SIZE_CLASS,
  buildCreateValues,
  buildPicsumUrl,
  isUrl,
  parseBackgroundImage,
  parseBackdrop,
  parseFormChange,
  parseFormWrite,
  parseTileOptions,
  parseTileToForm,
  tileOptionKey
}
