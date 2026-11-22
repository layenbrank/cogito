import { createRoot } from 'react-dom/client'

import { bootstrapAppearance } from '@/features/appearance/theme.ts'
import { ensurePrefs } from '@/features/platform/prefs.ts'
import { ensureSecrets } from '@/features/platform/secrets.ts'
import Side from '@/views/side/side.tsx'

import '@/styles/tailwind.css'
import '@/styles/index.scss'

bootstrapAppearance()
void ensurePrefs()
void ensureSecrets()

const container = document.getElementById('app')

if (container) {
  createRoot(container).render(<Side />)
}
