import { Effect } from '@tauri-apps/api/window'

import type { WebviewOptions } from '@tauri-apps/api/webview'
import type { WindowOptions } from '@tauri-apps/api/window'

type Configure = Omit<WebviewOptions, 'x' | 'y' | 'width' | 'height'> & WindowOptions

type WindowConfigure = Partial<Record<MagneticTile.Component, Configure>>

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
  theme: 'light',
  titleBarStyle: 'transparent',
  transparent: true,
  visible: true,
  width: 1200,
  windowEffects: {
    effects: [Effect.Tabbed, Effect.Mica, Effect.Acrylic]
  }
}

const WINDOW: WindowConfigure = {
  bookmark: DEFAULT,
  calendar: {
    ...DEFAULT,
    width: 600,
    minWidth: 600,
    height: 400,
    minHeight: 400,
    windowEffects: undefined
  },
  clipchamp: DEFAULT,
  clock: {
    ...DEFAULT,
    width: 480,
    minWidth: 360,
    height: 360,
    shadow: false,
    minHeight: 280,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    windowEffects: undefined
  },
  countdown: {
    ...DEFAULT,
    width: 400,
    minWidth: 360,
    height: 420,
    shadow: false,
    minHeight: 380,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    windowEffects: undefined
  },
  code: DEFAULT,
  collection: DEFAULT,
  developer: DEFAULT,
  example: DEFAULT,
  gallery: DEFAULT,
  agent: DEFAULT,
  markdown: DEFAULT,
  morph: {
    ...DEFAULT,
    windowEffects: undefined
  },
  marketplace: {
    ...DEFAULT,
    minWidth: 900,
    minHeight: 600,
    transparent: true
  },
  navigation: {
    ...DEFAULT,
    transparent: true
  },
  capture: {
    ...DEFAULT,
    fullscreen: false
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

/** 未登记的磁贴回落到 DEFAULT，避免新增组件时漏配就建不出窗 */
function findTileWindowOptions(component: MagneticTile.Component): Configure {
  return WINDOW[component] ?? DEFAULT
}

export { DEFAULT, findTileRoute, findTileWindowOptions, WINDOW }
