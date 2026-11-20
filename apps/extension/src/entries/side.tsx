import { createRoot } from 'react-dom/client'

import { bootstrapAppearance } from '@/features/appearance/theme.ts'
import Side from '@/views/side/side.tsx'

import '@/styles/tailwind.css'
import '@/styles/index.scss'

bootstrapAppearance()

const container = document.getElementById('app')

if (container) {
  createRoot(container).render(<Side />)
}
