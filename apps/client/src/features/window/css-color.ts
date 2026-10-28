/**
 * 设计 token → 具体颜色值。
 *
 * Monaco（`Color.fromHex` / `ColorMap`）与 xterm（canvas 绘制）都不认 `oklch()` /
 * `color-mix()`，必须先经 DOM 解析成具体色值。统一输出 `#RRGGBB` / `#RRGGBBAA`：
 * Monaco 的 token 颜色只接受这种格式，传 `rgb()` 会直接抛错。
 * 集中在这里处理，避免各视图各写一份。
 */

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_PATTERN = /^rgba?\(([^)]+)\)$/i

/** 应用外观以根节点 `.dark` 为唯一来源（见 features/window/appearance.ts）。 */
function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

function clampChannel(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(0, value))
}

/** 解析 `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()`；其余写法返回 null。 */
function parseCssColor(value: string): Rgba | null {
  const text = value.trim()

  const hexMatch = HEX_PATTERN.exec(text)
  if (hexMatch) {
    const digits = hexMatch[1]
    if (digits.length === 3) {
      return {
        r: Number.parseInt(`${digits[0]}${digits[0]}`, 16),
        g: Number.parseInt(`${digits[1]}${digits[1]}`, 16),
        b: Number.parseInt(`${digits[2]}${digits[2]}`, 16),
        a: 1
      }
    }
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a: digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
    }
  }

  const rgbMatch = RGB_PATTERN.exec(text)
  if (!rgbMatch) return null
  const parts = rgbMatch[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(function (part) {
      return part.length > 0
    })
  if (parts.length < 3) return null
  return {
    r: clampChannel(parseChannel(parts[0], 255), 255),
    g: clampChannel(parseChannel(parts[1], 255), 255),
    b: clampChannel(parseChannel(parts[2], 255), 255),
    a: parts.length > 3 ? clampChannel(parseChannel(parts[3], 1), 1) : 1
  }
}

function parseChannel(text: string, scale: number): number {
  if (text.endsWith('%')) {
    return (Number.parseFloat(text.slice(0, -1)) / 100) * scale
  }
  return Number.parseFloat(text)
}

/**
 * 兜底：把任意 CSS 颜色（`oklch()` / `color(srgb …)` / `color-mix()`）交给 canvas
 * 归一化。Chromium 只在部分版本把计算值序列化成 `rgb()`，不能只靠字符串。
 */
function sampleViaCanvas(color: string): Rgba | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.clearRect(0, 0, 1, 1)
  // fillStyle 不接受的值会被静默忽略，先置一个哨兵色判断是否生效
  context.fillStyle = '#000001'
  context.fillStyle = color
  if (context.fillStyle === '#000001') return null
  context.fillRect(0, 0, 1, 1)
  const data = context.getImageData(0, 0, 1, 1).data
  return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 }
}

function formatColor(color: Rgba): string {
  const hex = function (value: number): string {
    return Math.round(clampChannel(value, 255)).toString(16).padStart(2, '0')
  }
  const base = `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`
  const alpha = Math.round(clampChannel(color.a, 1) * 255)
  if (alpha >= 255) return base
  return `${base}${alpha.toString(16).padStart(2, '0')}`
}

function toColor(value: string): Rgba | null {
  return parseCssColor(value) ?? sampleViaCanvas(value)
}

/**
 * 把 CSS 变量解析成 `#RRGGBB` / `#RRGGBBAA`；取不到时返回 fallback。
 * 需要在 DOM 挂载后调用（变量作用在 `:root` / `.dark` 上）。
 */
function resolveCssColor(variable: string, fallback: string): string {
  if (typeof document === 'undefined' || !document.body) return fallback
  const probe = document.createElement('span')
  probe.style.color = `var(${variable})`
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  if (!resolved || resolved === 'rgba(0, 0, 0, 0)') return fallback
  const color = toColor(resolved)
  return color ? formatColor(color) : fallback
}

/** 给颜色换一个不透明度（用于选区、行号、缩进参考线这类需要压淡的地方）。 */
function withAlpha(value: string, alpha: number): string {
  const color = toColor(value)
  if (!color) return value
  return formatColor({ ...color, a: alpha })
}

/**
 * 把半透明色压到实色上。
 * `.dark` 的 `--border` / `--input` 是 `oklch(1 0 0 / 10%)`，Monaco 需要实色边框。
 */
function flattenColor(over: string, under: string): string {
  const top = toColor(over)
  const bottom = toColor(under)
  if (!top) return under
  if (!bottom) return over
  const alpha = top.a
  return formatColor({
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1
  })
}

/** 按比例混合两个颜色（`weight` 为后者占比，0..1）。 */
function mixColor(from: string, to: string, weight: number): string {
  const a = toColor(from)
  const b = toColor(to)
  if (!a) return to
  if (!b) return from
  const ratio = Math.min(1, Math.max(0, weight))
  return formatColor({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
    a: a.a + (b.a - a.a) * ratio
  })
}

export { isDarkTheme, resolveCssColor, withAlpha, flattenColor, mixColor, parseCssColor, formatColor }
export type { Rgba }
