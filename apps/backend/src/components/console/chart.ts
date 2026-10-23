interface ChartPoint {
  label: string
  value: number
}

function readCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** 读取控制台主题色，供图表与 shadcn token 对齐 */
function findChartTheme() {
  return {
    accent: readCssVar('--backend-accent', '#2a9d8f'),
    danger: readCssVar('--backend-danger', '#c45c3e'),
    warn: readCssVar('--backend-warn', '#b8860b'),
    ok: readCssVar('--backend-ok', '#3d8b6e'),
    muted: readCssVar('--muted-foreground', '#737373'),
    border: readCssVar('--border', '#e5e5e5'),
    foreground: readCssVar('--foreground', '#171717'),
    surface: readCssVar('--backend-surface', '#ffffff')
  }
}

export { findChartTheme }
export type { ChartPoint }
