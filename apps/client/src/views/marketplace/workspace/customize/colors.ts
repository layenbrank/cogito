import { normalizeHex } from '@/utils/color'

type ColorFieldName = 'color' | 'textColor'

type RgbChannel = 'r' | 'g' | 'b'

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsv {
  h: number
  s: number
  v: number
}

const TEXT_COLOR = '#FFFFFF'
const RAMP_LIGHT = 0.97
const RAMP_DARK = 0.08
const PRESET_STEPS = 7
const DERIVED_STEPS = 9

interface RampSeed {
  name: string
  hue: number
  saturation: number
  lightness: number
}

interface RampStop {
  name: string
  hex: string
}

/** 同一明度节奏的色相，每组再展开成浅→深色阶。不用旧的零散主色。 */
const RAMP_SEEDS: RampSeed[] = [
  { name: '石板', hue: 222, saturation: 14, lightness: 46 },
  { name: '红', hue: 4, saturation: 72, lightness: 52 },
  { name: '橙', hue: 22, saturation: 82, lightness: 52 },
  { name: '琥珀', hue: 38, saturation: 84, lightness: 50 },
  { name: '黄', hue: 48, saturation: 86, lightness: 50 },
  { name: '绿', hue: 152, saturation: 48, lightness: 40 },
  { name: '青', hue: 186, saturation: 64, lightness: 42 },
  { name: '蓝', hue: 216, saturation: 74, lightness: 50 },
  { name: '靛', hue: 244, saturation: 60, lightness: 52 },
  { name: '紫', hue: 274, saturation: 56, lightness: 50 },
  { name: '品红', hue: 326, saturation: 64, lightness: 52 },
  { name: '玫瑰', hue: 350, saturation: 66, lightness: 52 }
]

function clampChannel(value: number) {
  if (value < 0) return 0
  if (value > 255) return 255
  return Math.round(value)
}

function clampUnit(value: number) {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** `#RGB` / `#RRGGBB` → 大写 6 位；非法返回 null */
function parseHexColor(color: string): string | null {
  const raw = color.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(raw) || /^[0-9a-fA-F]{6}$/.test(raw)) {
    return normalizeHex(raw)
  }
  return null
}

function parseRgb(hex: string): Rgb {
  const raw = normalizeHex(hex).slice(1)
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16)
  }
}

/** Hex → HSV。无彩色相为 0，调用方需要保留色相时自行记住上一次的 h。 */
function parseHsv(hex: string): Hsv {
  const rgb = parseRgb(hex)
  const red = rgb.r / 255
  const green = rgb.g / 255
  const blue = rgb.b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min

  let hue = 0
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue *= 60
    if (hue < 0) hue += 360
  }

  return {
    h: hue,
    s: max === 0 ? 0 : delta / max,
    v: max
  }
}

function hsvToRgb(hsv: Hsv): Rgb {
  const hue = ((hsv.h % 360) + 360) % 360
  const saturation = clampUnit(hsv.s)
  const value = clampUnit(hsv.v)
  const chroma = value * saturation
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = value - chroma
  const sector = Math.floor(hue / 60) % 6
  const channels: [number, number, number][] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary]
  ]
  const [red, green, blue] = channels[sector]

  return {
    r: clampChannel((red + match) * 255),
    g: clampChannel((green + match) * 255),
    b: clampChannel((blue + match) * 255)
  }
}

function rgbToHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map(function (channel) {
      return clampChannel(channel).toString(16).padStart(2, '0')
    })
    .join('')
    .toUpperCase()}`
}

function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv))
}

function readColor(value: string | undefined, fallback: string) {
  return parseHexColor(value ?? '') ?? parseHexColor(fallback) ?? TEXT_COLOR
}

function hslToHsv(hue: number, saturation: number, lightness: number): Hsv {
  const chroma = clampUnit(saturation / 100)
  const level = clampUnit(lightness / 100)
  const value = level + chroma * Math.min(level, 1 - level)
  return {
    h: hue,
    s: value === 0 ? 0 : 2 * (1 - level / value),
    v: value
  }
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  return hsvToHex(hslToHsv(hue, saturation, lightness))
}

function hsvToHsl(hsv: Hsv) {
  const value = clampUnit(hsv.v)
  const saturation = clampUnit(hsv.s)
  const lightness = value * (1 - saturation / 2)
  const span = Math.min(lightness, 1 - lightness)
  return {
    h: hsv.h,
    s: span === 0 ? 0 : (value - lightness) / span,
    l: lightness
  }
}

/** 浅 → 当前色 → 深。正中一档是入参本身，两侧按明度拉开。 */
function buildRamp(hex: string, steps: number): string[] {
  const seed = parseHexColor(hex) ?? TEXT_COLOR
  const hsl = hsvToHsl(parseHsv(seed))
  const mid = (steps - 1) / 2
  const lightTarget = hsl.l >= RAMP_LIGHT ? 1 : RAMP_LIGHT
  const darkTarget = hsl.l <= RAMP_DARK ? 0 : RAMP_DARK

  return Array.from({ length: steps }, function (_, index) {
    if (index === mid) return seed
    const delta = (index - mid) / mid
    if (delta < 0) {
      const amount = -delta
      return hslToHex(
        hsl.h,
        hsl.s * (1 - amount * 0.28) * 100,
        (hsl.l + (lightTarget - hsl.l) * amount) * 100
      )
    }
    return hslToHex(
      hsl.h,
      hsl.s * (1 - delta * 0.34) * 100,
      (hsl.l + (darkTarget - hsl.l) * delta) * 100
    )
  })
}

function buildPresetRamps(): RampStop[][] {
  return RAMP_SEEDS.map(function (seed) {
    const hex = hslToHex(seed.hue, seed.saturation, seed.lightness)
    return buildRamp(hex, PRESET_STEPS).map(function (stop) {
      return { name: seed.name, hex: stop }
    })
  })
}

const PRESET_RAMPS = buildPresetRamps()

function buildDerivedRamp(hex: string) {
  return buildRamp(hex, DERIVED_STEPS)
}

export type { ColorFieldName, Hsv, RampStop, Rgb, RgbChannel }
export {
  PRESET_RAMPS,
  TEXT_COLOR,
  buildDerivedRamp,
  hsvToHex,
  parseHexColor,
  parseHsv,
  parseRgb,
  readColor,
  rgbToHex
}
