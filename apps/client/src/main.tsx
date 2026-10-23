import { addCollection } from '@iconify/react/offline'
import { createRoot } from 'react-dom/client'
import 'reflect-metadata'

import App from '@/App.tsx'
import { ensurePersist, ensureSecrets, findPref } from '@/features/persist'
import { watchActiveTenant } from '@/features/quota/tenant.ts'
import { adoptAppearance, watchAppearance } from '@/features/window/appearance'
import {
  installExceptionReporting,
  reportUnknown
} from '@/utils/exception-report.ts'
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

installExceptionReporting()

const rootElement = document.getElementById('root') as HTMLElement
const appRoot = createRoot(rootElement, {
  onCaughtError(error) {
    // 只打日志：ErrorBoundary / CaptureErrorBoundary / OverlayBoundary 已 reportUnknown
    console.error('Root caught an error:', error)
  },
  onUncaughtError(error) {
    console.error('Root caught an uncaught error:', error)
    reportUnknown(error, { kind: 'react.onUncaughtError' }, 'fatal')
  },
  onRecoverableError(error) {
    console.error('Root caught a recoverable error:', error)
    reportUnknown(error, { kind: 'react.onRecoverableError' }, 'warning')
  },
  identifierPrefix: IDENTIFIER_PREFIX
})

async function bootstrap() {
  await ensurePersist()
  await ensureSecrets()
  adoptAppearance(findPref('window').appearance)
  watchAppearance()
  // 租户身份：登录 / 切账号后重新解析，好让请求带上 `X-Tenant-ID`（网关按它算配额归属）
  watchActiveTenant()
  appRoot.render(<App />)
}

void bootstrap()
