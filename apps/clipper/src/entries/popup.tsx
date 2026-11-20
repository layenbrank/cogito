import { createRoot } from 'react-dom/client'

import { PopupSurface } from '@/features/shell/popup-surface.tsx'
import { bootstrapTheme } from '@/features/shell/theme.ts'

import '@/styles/tailwind.css'

bootstrapTheme()

const container = document.getElementById('app')
if (container) {
  createRoot(container).render(<PopupSurface />)
}
