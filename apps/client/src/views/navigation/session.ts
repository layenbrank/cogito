import { LazyStore } from '@tauri-apps/plugin-store'

interface Tab {
  id: string
  url: string
  title: string
}

interface ClosedTab {
  id: string
  url: string
  title: string
  index: number
}

interface BrowserSnapshot {
  tabs: Tab[]
  activeId: string
  searches: string[]
  closed: ClosedTab[]
}

const SEARCH_LIMIT = 20
const CLOSED_LIMIT = 25
const BROWSER_KEY = 'browser'
const LEGACY_KEY = 'session'
const EMPTY: BrowserSnapshot = { tabs: [], activeId: '', searches: [], closed: [] }
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

function parseClosed(value: unknown) {
  if (!Array.isArray(value)) return []
  const closed: ClosedTab[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as ClosedTab
    if (!isTab(row) || !row.url || typeof row.index !== 'number' || row.index < 0) continue
    closed.push({ id: row.id, url: row.url, title: row.title, index: Math.floor(row.index) })
    if (closed.length >= CLOSED_LIMIT) break
  }
  return closed
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
    searches: parseSearches(raw.searches),
    closed: parseClosed(raw.closed)
  }
}

function rememberClosed(current: ClosedTab[], tab: Tab, index: number) {
  if (!tab.url) return current
  const next = [
    { id: tab.id, url: tab.url, title: tab.title, index: Math.max(0, index) },
    ...current.filter(function (item) {
      return item.id !== tab.id
    })
  ]
  return next.slice(0, CLOSED_LIMIT)
}

function dropClosed(current: ClosedTab[], id: string) {
  return current.filter(function (item) {
    return item.id !== id
  })
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

export { CLOSED_LIMIT, dropClosed, parseTabs, readBrowser, rememberClosed, writeBrowser }
export type { BrowserSnapshot, ClosedTab, Tab }
