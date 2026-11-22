/**
 * `chrome.storage.local` 的薄封装。键名集中在这里，业务代码不写字面量。
 * 只在扩展里运行，不提供网页内存替身。
 */

const STORAGE_KEYS = {
  prefs: 'cogito.prefs',
  secrets: 'cogito.secrets',
  pending: 'cogito.agent.pending'
} as const

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

function findArea(): chrome.storage.StorageArea {
  return chrome.storage.local
}

async function findValue<T>(key: StorageKey): Promise<T | null> {
  const bag = await findArea().get(key)
  const value = bag[key]
  return value === undefined ? null : (value as T)
}

async function writeValue(key: StorageKey, value: unknown): Promise<void> {
  await findArea().set({ [key]: value })
}

async function removeValue(key: StorageKey): Promise<void> {
  await findArea().remove(key)
}

function subscribeValue(key: StorageKey, listener: (value: unknown) => void): () => void {
  const area = findArea()
  function onChange(changes: Record<string, chrome.storage.StorageChange>): void {
    const change = changes[key]
    if (!change) return
    listener(change.newValue)
  }
  area.onChanged.addListener(onChange)
  return function () {
    area.onChanged.removeListener(onChange)
  }
}

export { STORAGE_KEYS, findValue, removeValue, subscribeValue, writeValue }
export type { StorageKey }
