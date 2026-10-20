/**
 * Omnibar：引擎偏好 + 最近命中
 */
import { ENGINE_STORE_KEY, ENGINES, findEngine } from '@/constants/engine'
import { OMNIBAR_UI, RECENT_ID_PREFIX } from '@/features/command-bar/constants'
import type { Hit, HitDomain } from '@/features/command-bar/types'

const RECENT_STORE_KEY = 'command-bar.recent'

interface RecentHit {
  domain: HitDomain
  id: string
  title: string
  subtitle?: string
  icon?: string
}

function parseEngineKey(value: unknown): string {
  if (!value || typeof value !== 'object') return ENGINES[0].key
  const key = (value as { key?: unknown }).key
  if (typeof key !== 'string') return ENGINES[0].key
  const known = ENGINES.some(function (engine) {
    return engine.key === key
  })
  return known ? key : ENGINES[0].key
}

function readEngineKey(): string {
  if (typeof localStorage === 'undefined') return ENGINES[0].key
  try {
    const raw = localStorage.getItem(ENGINE_STORE_KEY)
    if (!raw) return ENGINES[0].key
    return parseEngineKey(JSON.parse(raw) as unknown)
  } catch (error) {
    console.warn('[command-bar] 引擎偏好存档损坏，回落默认:', error)
    return ENGINES[0].key
  }
}

function writeEngineKey(key: string): void {
  if (typeof localStorage === 'undefined') return
  const engine = findEngine(key)
  localStorage.setItem(ENGINE_STORE_KEY, JSON.stringify({ key: engine.key }))
}

function parseRecent(value: unknown): RecentHit[] {
  if (!Array.isArray(value)) return []
  const hits: RecentHit[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.domain !== 'string' || typeof row.id !== 'string') continue
    if (typeof row.title !== 'string') continue
    hits.push({
      domain: row.domain as HitDomain,
      id: row.id,
      title: row.title,
      subtitle: typeof row.subtitle === 'string' ? row.subtitle : undefined,
      icon: typeof row.icon === 'string' ? row.icon : undefined
    })
  }
  return hits.slice(0, OMNIBAR_UI.RECENT_LIMIT)
}

function readRecentHits(): RecentHit[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_STORE_KEY)
    if (!raw) return []
    return parseRecent(JSON.parse(raw) as unknown)
  } catch (error) {
    console.warn('[command-bar] 最近命中存档损坏:', error)
    return []
  }
}

function writeRecentHit(hit: Pick<Hit, 'domain' | 'id' | 'title' | 'subtitle' | 'icon'>): void {
  if (typeof localStorage === 'undefined') return
  const id = hit.id.startsWith(RECENT_ID_PREFIX)
    ? hit.id.slice(RECENT_ID_PREFIX.length)
    : hit.id
  const next: RecentHit = {
    domain: hit.domain,
    id,
    title: hit.title,
    subtitle: hit.subtitle,
    icon: hit.icon
  }
  const prior = readRecentHits().filter(function (item) {
    return !(item.domain === next.domain && item.id === next.id)
  })
  const series = [next, ...prior].slice(0, OMNIBAR_UI.RECENT_LIMIT)
  localStorage.setItem(RECENT_STORE_KEY, JSON.stringify(series))
}

export type { RecentHit }
export {
  parseEngineKey,
  readEngineKey,
  writeEngineKey,
  readRecentHits,
  writeRecentHit,
  RECENT_STORE_KEY
}
