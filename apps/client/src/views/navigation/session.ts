import { LazyStore } from '@tauri-apps/plugin-store'

interface Tab {
  id: string
  url: string
  title: string
}

interface Session {
  tabs: Tab[]
  activeId: string
}

const EMPTY: Session = { tabs: [], activeId: '' }
const STORE_KEY = 'session'
const store = new LazyStore('navigation-session.json')

function isTab(value: unknown): value is Tab {
  if (!value || typeof value !== 'object') return false
  const tab = value as Tab
  return typeof tab.id === 'string' && typeof tab.url === 'string' && typeof tab.title === 'string'
}

async function readSession(): Promise<Session> {
  const value = await store.get<Session>(STORE_KEY)
  if (!value || !Array.isArray(value.tabs)) return EMPTY
  const tabs = value.tabs.filter(isTab)
  const activeId = tabs.some(function (tab) {
    return tab.id === value.activeId
  })
    ? value.activeId
    : (tabs[0]?.id ?? '')
  return { tabs, activeId }
}

async function writeSession(session: Session) {
  await store.set(STORE_KEY, session)
  await store.save()
}

export { readSession, writeSession }
export type { Session, Tab }
