interface ChartPoint {
  label: string
  value: number
}

interface NamedCount {
  name: string
  value: number
}

interface ChartTheme {
  accent: string
  danger: string
  warn: string
  ok: string
  muted: string
  border: string
  foreground: string
  surface: string
  /** 多序列/扇区调色，优先设计 token `--chart-*` */
  palette: string[]
}

function readCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function readCssVarChain(names: string[], fallback: string) {
  for (const name of names) {
    const value = readCssVar(name, '')
    if (value) return value
  }
  return fallback
}

/** 读取图表主题色：优先 app 覆盖（如 `--backend-*`），否则设计 token */
function findChartTheme(): ChartTheme {
  const accent = readCssVarChain(['--backend-accent', '--chart-1', '--primary'], '#2a9d8f')
  const danger = readCssVarChain(['--backend-danger', '--destructive'], '#c45c3e')
  const warn = readCssVarChain(['--backend-warn', '--warning'], '#b8860b')
  const ok = readCssVarChain(['--backend-ok', '--success'], '#3d8b6e')
  const muted = readCssVar('--muted-foreground', '#737373')
  return {
    accent,
    danger,
    warn,
    ok,
    muted,
    border: readCssVar('--border', '#e5e5e5'),
    foreground: readCssVar('--foreground', '#171717'),
    surface: readCssVarChain(['--backend-surface', '--card', '--background'], '#ffffff'),
    palette: [
      readCssVar('--chart-1', accent),
      readCssVar('--chart-2', warn),
      readCssVar('--chart-3', danger),
      readCssVar('--chart-4', ok),
      readCssVar('--chart-5', muted)
    ]
  }
}

export { findChartTheme }
export type { ChartPoint, ChartTheme, NamedCount }
