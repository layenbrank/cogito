import { createRoot } from 'react-dom/client'

import { bootstrapAppearance } from '@/features/appearance/theme.ts'
import Popup from '@/views/popup/popup.tsx'

import '@/styles/tailwind.css'

bootstrapAppearance()

const container = document.getElementById('app')

if (container) {
  createRoot(container).render(<Popup />)
}
