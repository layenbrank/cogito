/**
 * Store 文件名映射：namespace → 单词汇文件名。
 */
const STORE_FILE = {
  settings: 'settings.json',
  tiles: 'tiles.json',
  agent: 'agent.json',
  window: 'window.json',
  clipchamp: 'clipchamp.json',
  gallery: 'gallery.json',
  vault: 'vault.json',
  /** 诊断偏好：崩溃补报开关等（不涉密） */
  diagnostics: 'diagnostics.json'
} as const

type PersistNamespace = keyof typeof STORE_FILE

export type { PersistNamespace }
export { STORE_FILE }
