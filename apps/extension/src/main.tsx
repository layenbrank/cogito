import { addCollection } from '@iconify/react/offline'
import { createRoot } from 'react-dom/client'

import IconSubset from '@/assets/iconify-subset.json'
import { bootstrapAppearance } from '@/features/appearance/theme.ts'
import { ensurePrefs } from '@/features/platform/prefs.ts'
import { ensureSecrets } from '@/features/platform/secrets.ts'
import App from './App.tsx'

import 'reflect-metadata'

import '@/styles/tailwind.css'
import '@/styles/index.scss'

for (const collection of IconSubset) {
  addCollection(collection as unknown as Parameters<typeof addCollection>[0])
}

bootstrapAppearance()
// 平台层是异步存储（chrome.storage），但读取路径必须是同步的（渲染里不能 await）：
// 先把缓存灌好再挂载。订阅了 prefs 的组件会在 hydrate 完成时自动重渲染。
void ensurePrefs()
void ensureSecrets()

const container = document.getElementById('app')

if (container) {
  createRoot(container).render(<App />)
}
