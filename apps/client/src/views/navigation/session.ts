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
const BROWSER_KEY = 'browser'
const LEGACY_KEY = 'session'
const EMPTY: BrowserSnapshot = { tabs: [], activeId: '', searches: [] }
const store = new LazyStore('navigation-session.json')

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

async function readBrowser(): Promise<BrowserSnapshot> {
  const current = await store.get<BrowserSnapshot>(BROWSER_KEY)
  if (current) return parseTabs(current)
  const legacy = await store.get<BrowserSnapshot>(LEGACY_KEY)
  if (!legacy) return EMPTY
  return parseTabs(legacy)
}

async function writeBrowser(snapshot: BrowserSnapshot) {
  await store.set(BROWSER_KEY, parseTabs(snapshot))
  await store.delete(LEGACY_KEY)
  await store.save()
}

export { parseTabs, readBrowser, writeBrowser }
export type { BrowserSnapshot, Tab }
