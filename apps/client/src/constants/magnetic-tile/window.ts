import type { WebviewOptions } from '@tauri-apps/api/webview'
import type { WindowOptions } from '@tauri-apps/api/window'

import {
  findWindowEffects,
  isDarkMode,
  readAppearance
} from '@/features/window/appearance'

type Configure = Omit<WebviewOptions, 'x' | 'y' | 'width' | 'height'> & WindowOptions

type WindowConfigure = Partial<Record<MagneticTile.Component, Configure>>

function findAppearanceWindowOptions(): Pick<Configure, 'theme' | 'windowEffects'> {
  const appearance = readAppearance()
  const isDark = isDarkMode(appearance.mode)
  // 建窗必须给明确 light|dark（Omit/null 在部分平台建窗会拒）；跟随系统时按当前有效明暗写死
  return {
    theme: isDark ? 'dark' : 'light',
    windowEffects: findWindowEffects(isDark)
  }
}

const DEFAULT: Configure = {
  backgroundColor: '#00000000',
  center: true,
  closable: true,
  contentProtected: false,
  devtools: true,
  dragDropEnabled: true,
  focus: true,
  fullscreen: false,
  height: 800,
  maximizable: true,
  minHeight: 600,
  minWidth: 800,
  resizable: true,
  decorations: false,
  shadow: true,
  skipTaskbar: false,
  titleBarStyle: 'transparent',
  transparent: true,
  visible: true,
  width: 1200,
  ...findAppearanceWindowOptions()
}

const WINDOW: WindowConfigure = {
  bookmark: DEFAULT,
  calendar: {
    ...DEFAULT,
    width: 1020,
    minWidth: 840,
    height: 700,
    minHeight: 600
  },
  clipchamp: DEFAULT,
  clock: {
    ...DEFAULT,
    width: 880,
    minWidth: 720,
    height: 600,
    minHeight: 520
  },
  countdown: {
    ...DEFAULT,
    width: 880,
    minWidth: 720,
    height: 600,
    minHeight: 520
  },
  code: DEFAULT,
  collection: DEFAULT,
  developer: DEFAULT,
  example: DEFAULT,
  gallery: DEFAULT,
  agent: DEFAULT,
  markdown: DEFAULT,
  morph: DEFAULT,
  marketplace: {
    ...DEFAULT,
    minWidth: 900,
    minHeight: 600
  },
  navigation: DEFAULT,
  capture: {
    ...DEFAULT
  },
  settings: DEFAULT,
  signboard: DEFAULT,
  directive: DEFAULT
}

/**
 * 磁贴 → 窗口路由：与 `views/<component>` 同形（`/agent`、`/morph` …）。
 * 组件名即路由段，所以这里不再需要例外表。
 */
function findTileRoute(component: MagneticTile.Component) {
  return `/${component}`
}

/**
 * 未登记的磁贴回落到 DEFAULT；每次取选项时重读 appearance，
 * 避免模块加载时写死的 theme/effects 与之后切换的外观脱节。
 */
function findTileWindowOptions(component: MagneticTile.Component): Configure {
  const base = WINDOW[component] ?? DEFAULT
  return {
    ...base,
    ...findAppearanceWindowOptions()
  }
}

export { DEFAULT, findTileRoute, findTileWindowOptions, WINDOW }
