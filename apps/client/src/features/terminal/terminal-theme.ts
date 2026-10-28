/**
 * xterm 主题：把设计 token CSS 变量解析成 canvas 可用的具体色值（`#RRGGBB`）。
 * 交互终端与指令「输出」只读 xterm 共用。
 */
import type { ITheme } from '@xterm/xterm'

import { isDarkTheme, resolveCssColor } from '@/features/window/css-color.ts'

/** 应用外观以根节点 `.dark` 为唯一来源（见 features/window/appearance.ts）。 */
const isDarkMode = isDarkTheme

/**
 * 终端主题跟随设计 token（`--background` / `--foreground` 等）。
 * 浅色下压低 white / brightWhite，避免 PSReadLine 幽灵补全在白底上看不见。
 */
function resolveTerminalTheme(): ITheme {
  const isDark = isDarkMode()
  const background = resolveCssColor('--background', isDark ? '#0d1117' : '#ffffff')
  const foreground = resolveCssColor('--foreground', isDark ? '#d4d4d4' : '#1f2328')
  const muted = resolveCssColor('--muted-foreground', isDark ? '#8b949e' : '#656d76')
  const primary = resolveCssColor('--primary', isDark ? '#3b8eea' : '#0451a5')

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: isDark
      ? 'rgba(56, 139, 253, 0.35)'
      : 'rgba(9, 105, 218, 0.25)',
    selectionForeground: foreground,
    black: isDark ? '#484f58' : '#24292f',
    red: isDark ? '#ff7b72' : '#cf222e',
    green: isDark ? '#3fb950' : '#116329',
    yellow: isDark ? '#d29922' : '#4d2d00',
    blue: primary,
    magenta: isDark ? '#bc8cff' : '#8250df',
    cyan: isDark ? '#39c5cf' : '#116329',
    white: isDark ? '#b1bac4' : muted,
    brightBlack: muted,
    brightRed: isDark ? '#ffa198' : '#a40e26',
    brightGreen: isDark ? '#56d364' : '#1a7f37',
    brightYellow: isDark ? '#e3b341' : '#633c01',
    brightBlue: primary,
    brightMagenta: isDark ? '#d2a8ff' : '#8250df',
    brightCyan: isDark ? '#56d4dd' : '#0550ae',
    brightWhite: isDark ? '#f0f6fc' : foreground
  }
}

export { isDarkMode, resolveCssColor, resolveTerminalTheme }
