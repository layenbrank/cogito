import { createRoot } from 'react-dom/client'

import { bootstrapAppearance } from '@/features/appearance/theme.ts'
import App from './App.tsx'

import 'reflect-metadata'

import '@/styles/tailwind.css'
import '@/styles/index.scss'

bootstrapAppearance()

const container = document.getElementById('app')

if (container) {
  createRoot(container).render(<App />)
}
