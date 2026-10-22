import { addCollection } from '@iconify/react/offline'
import { createRoot } from 'react-dom/client'
import 'reflect-metadata'

import App from '@/App.tsx'
import {
  installExceptionReporting,
  reportUnknown
} from '@/utils/exception-report.ts'
import '@/styles/tailwind.css'
import '@/styles/index.scss'

import LucideIconify from '@iconify/json/json/lucide.json'

addCollection(LucideIconify)
installExceptionReporting()

const rootElement = document.getElementById('root') as HTMLElement
createRoot(rootElement, {
  onCaughtError(error) {
    // 只打日志：ErrorBoundary 已 reportUnknown，避免同一 Error 双报
    console.error('Root caught an error:', error)
  },
  onUncaughtError(error) {
    console.error('Root caught an uncaught error:', error)
    reportUnknown(error, { kind: 'react.onUncaughtError' }, 'fatal')
  },
  identifierPrefix: 'ith-backend'
}).render(<App />)
