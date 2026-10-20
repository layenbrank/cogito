import { addCollection } from '@iconify/react/offline'
import { createRoot } from 'react-dom/client'
import 'reflect-metadata'

import App from '@/App.tsx'
import '@/styles/tailwind.css'
import '@/styles/index.scss'

import LucideIconify from '@iconify/json/json/lucide.json'

addCollection(LucideIconify)

const rootElement = document.getElementById('root') as HTMLElement
createRoot(rootElement, {
  onCaughtError(error) {
    console.error('Root caught an error:', error)
  },
  onUncaughtError(error) {
    console.error('Root caught an uncaught error:', error)
  },
  identifierPrefix: 'ith-backend'
}).render(<App />)
