/**
 * 颜色工具：hex ⇄ HSL 与 10 档色阶。
 *
 * 原先色阶依赖 `@ant-design/colors` 的 `generate()`；antd 已下线，这里用
 * HSL 插值自绘一条「浅 → 主色 → 深」的单调色阶，步进与 antd 的观感对齐
 * （第 6 档恰好是主色本身），调用方无需感知实现差异。
 */

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsl {
  h: number
  s: number
  l: number
}

/** antd 预设色相：色板候选色，与主题主色一起构成平铺色板 */
const PRESET_PRIMARY_COLORS = [
  '#F5222D',
  '#FA541C',
  '#FA8C16',
  '#FAAD14',
  '#FADB14',
  '#A0D911',
  '#52C41A',
  '#13C2C2',
  '#1677FF',
  '#2F54EB',
  '#722ED1',
  '#EB2F96'
] as const

const RAMP_STEPS = 10
const LIGHT_LIGHTNESS = 0.96
const DARK_LIGHTNESS = 0.12

/** 统一大写 6 位 hex，保证色板/选中态比较稳定 */
function normalizeHex(color: string): string {
  const raw = color.trim().replace('#', '')
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map(function (char) {
            return char + char
          })
          .join('')
      : raw
  return `#${expanded.slice(0, 6).toUpperCase()}`
}

function parseRgb(hex: string): Rgb {
  const raw = normalizeHex(hex).replace('#', '')
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16)
  }
}

function parseHsl(hex: string): Hsl {
  const { r, g, b } = parseRgb(hex)
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2

  let hue = 0
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6
    else if (max === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue *= 60
    if (hue < 0) hue += 360
  }

  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  return { h: hue, s: saturation, l: lightness }
}

function toHex(hsl: Hsl): string {
  const saturation = Math.min(1, Math.max(0, hsl.s))
  const lightness = Math.min(1, Math.max(0, hsl.l))
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const secondary = chroma * (1 - Math.abs(((hsl.h / 60) % 2) - 1))
  const offset = lightness - chroma / 2

  const table: [number, number, number][] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary]
  ]
  const index = Math.floor((((hsl.h % 360) + 360) % 360) / 60) % 6
  const [red, green, blue] = table[index]

  return `#${[red, green, blue]
    .map(function (channel) {
      return Math.round((channel + offset) * 255)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')
    .toUpperCase()}`
}

/** 取 hex 的相对亮度（仅用于色阶分割点判定） */
function parseLightness(hex: string) {
  return parseHsl(hex).l
}

/**
 * 10 档色阶（浅 → 深）。中间档（下标 5）即入参主色，
 * 因此调用方可以「去掉主色再按亮度对半切」得到浅色组与深色组。
 */
function generateRamp(hex: string): string[] {
  const seed = normalizeHex(hex)
  const { h, s, l } = parseHsl(seed)

  return Array.from({ length: RAMP_STEPS }, function (_, index) {
    const ratio = index / (RAMP_STEPS - 1)
    if (ratio === 0.5) return seed
    if (ratio < 0.5) {
      const step = ratio / 0.5
      return toHex({ h, s, l: l + (LIGHT_LIGHTNESS - l) * (1 - step) })
    }
    const step = (ratio - 0.5) / 0.5
    return toHex({ h, s, l: l + (DARK_LIGHTNESS - l) * step })
  })
}

export { generateRamp, normalizeHex, parseLightness, PRESET_PRIMARY_COLORS }
