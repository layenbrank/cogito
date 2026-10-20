import { addCollection } from '@iconify/react/offline'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { createRoot } from 'react-dom/client'
import 'reflect-metadata'

import App from '@/App.tsx'
import { watchActiveTenant } from '@/features/quota/tenant.ts'
import { paintDocument, watchAppearance } from '@/features/window/appearance'
import { BrowserChrome } from '@/views/browser/chrome'
import { isBrowserWindow, isPopupWindow } from '@/features/window/kind'
import { SuggestPanel } from '@/views/navigation/suggest'
import '@/styles/tailwind.css'
import '@/styles/index.scss'

import AntIconify from '@iconify/json/json/ant-design.json'
import LucideIconify from '@iconify/json/json/lucide.json'
import MDIconify from '@iconify/json/json/mdi.json'

/** React 生成 DOM id 的前缀，避免与页面既有 id 冲突 */
const IDENTIFIER_PREFIX = 'ith'

addCollection(MDIconify)
addCollection(AntIconify)
addCollection(LucideIconify)

const rootElement = document.getElementById('root') as HTMLElement
const appRoot = createRoot(rootElement, {
  onCaughtError(error) {
    console.error('Root caught an error:', error)
  },
  onUncaughtError(error) {
    console.error('Root caught an uncaught error:', error)
  },
  onRecoverableError(error) {
    console.error('Root caught a recoverable error:', error)
  },
  identifierPrefix: IDENTIFIER_PREFIX
})

/**
 * 同一个 `index.html` 服务三类窗口，靠 label 分流：
 * - `navigation-popup-*`：地址建议浮层（不跑路由/托盘/租户那套开机流程）
 * - `browser`、`browser-2`…：浏览窗口（侧栏 + 地址栏 + 内容槽，不渲染工作台）
 * - 其它（`main` 等）：工作台 / 应用路由
 */
function findMode(): 'popup' | 'browser' | 'app' {
  if ('__ITH_SUGGEST_POPUP__' in window) return 'popup'
  if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return 'app'
  const label = getCurrentWebview().label
  if (isPopupWindow(label)) return 'popup'
  if (isBrowserWindow(label)) return 'browser'
  return 'app'
}

const mode = findMode()

if (mode === 'popup') {
  // 浮层跑在子窗口里：只把主题套到自己的文档，不去改窗口材质。
  paintDocument()
  appRoot.render(<SuggestPanel />)
} else {
  watchAppearance()
  if (mode === 'browser') {
    appRoot.render(<BrowserChrome />)
  } else {
    // 租户身份：登录 / 切账号后重新解析，好让请求带上 `X-Tenant-ID`（网关按它算配额归属）
    watchActiveTenant()
    appRoot.render(<App />)
  }
}
