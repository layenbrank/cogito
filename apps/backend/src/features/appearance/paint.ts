/** 与 client 外观预设对齐：品牌蓝、白字、10px 圆角。 */

const PRIMARY = '#4080ff'
const PRIMARY_FOREGROUND = '#ffffff'
const RADIUS = '10px'

type AppearanceMode = 'system' | 'light' | 'dark'

function isDarkMode(mode: AppearanceMode) {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function paintAppearance(mode: AppearanceMode) {
  const root = document.documentElement
  root.classList.toggle('dark', isDarkMode(mode))
  root.style.setProperty('--primary', PRIMARY)
  root.style.setProperty('--primary-foreground', PRIMARY_FOREGROUND)
  root.style.setProperty('--ring', PRIMARY)
  root.style.setProperty('--radius', RADIUS)
}

export { PRIMARY, paintAppearance }
export type { AppearanceMode }
