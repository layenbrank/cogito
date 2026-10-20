import { LazyStore } from '@tauri-apps/plugin-store'

interface Tab {
  id: string
  url: string
  title: string
}

interface BrowserSnapshot {
  tabs: Tab[]
  activeId: string
  searches: string[]
}

const SEARCH_LIMIT = 20
/** 第一扇浏览窗口的键，也是旧版本单窗口时代的键名。 */
const BROWSER_KEY = 'browser'
const LEGACY_KEY = 'session'
const EMPTY: BrowserSnapshot = { tabs: [], activeId: '', searches: [] }
const store = new LazyStore('navigation-session.json')

/**
 * 会话按窗口 label 分键：多扇浏览窗口各有各的标签，关掉一扇不会带走别家的。
 * 非 Tauri 环境（单测）拿不到 label，退化成单窗口。
 */
function keyOf(label: string): string {
  return label || BROWSER_KEY
}

function parseSearches(value: unknown) {
  if (!Array.isArray(value)) return []
  const searches: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!text || searches.includes(text)) continue
    searches.push(text)
    if (searches.length >= SEARCH_LIMIT) break
  }
  return searches
}

function isTab(value: unknown): value is Tab {
  if (!value || typeof value !== 'object') return false
  const tab = value as Tab
  return typeof tab.id === 'string' && typeof tab.url === 'string' && typeof tab.title === 'string'
}

function parseTabs(value: unknown) {
  if (!value || typeof value !== 'object') return EMPTY
  const raw = value as BrowserSnapshot
  const tabs = Array.isArray(raw.tabs) ? raw.tabs.filter(isTab) : []
  const activeId = tabs.some(function (tab) {
    return tab.id === raw.activeId
  })
    ? raw.activeId
    : (tabs[0]?.id ?? '')
  return {
    tabs,
    activeId,
    searches: parseSearches(raw.searches)
  }
}

async function readBrowser(label: string): Promise<BrowserSnapshot> {
  const key = keyOf(label)
  const current = await store.get<BrowserSnapshot>(key)
  if (current) return parseTabs(current)
  // 只有第一扇窗口会继承旧版本的单窗口会话（旧键 `session`）。
  if (key !== BROWSER_KEY) return EMPTY
  const legacy = await store.get<BrowserSnapshot>(LEGACY_KEY)
  if (!legacy) return EMPTY
  return parseTabs(legacy)
}

async function writeBrowser(label: string, snapshot: BrowserSnapshot) {
  const key = keyOf(label)
  await store.set(key, parseTabs(snapshot))
  if (key === BROWSER_KEY) await store.delete(LEGACY_KEY)
  await store.save()
}

export { parseTabs, readBrowser, writeBrowser }
export type { BrowserSnapshot, Tab }
