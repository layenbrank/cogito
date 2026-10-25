interface ChartPoint {
  label: string
  value: number
}

interface NamedCount {
  name: string
  value: number
  /** 条形填充色覆盖；缺省用主题 accent */
  fill?: string
}

function readCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** 读取 client CSS 变量，供图表与 design token 对齐 */
function findChartTheme() {
  return {
    accent: readCssVar('--primary', '#4f46e5'),
    danger: readCssVar('--destructive', '#c45c3e'),
    warn: readCssVar('--warning', '#b8860b'),
    ok: readCssVar('--success', '#3d8b6e'),
    muted: readCssVar('--muted-foreground', '#737373'),
    border: readCssVar('--border', '#e5e5e5'),
    foreground: readCssVar('--foreground', '#171717'),
    surface: readCssVar('--card', '#ffffff'),
    chart2: readCssVar('--chart-2', readCssVar('--warning', '#b8860b')),
    chart3: readCssVar('--chart-3', readCssVar('--success', '#3d8b6e'))
  }
}

export { findChartTheme }
export type { ChartPoint, NamedCount }
