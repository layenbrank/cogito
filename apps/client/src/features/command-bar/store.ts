/**
 * Omnibar：引擎偏好 + 最近命中（window.json）
 */
import { ENGINES, findEngine } from '@/constants/engine'
import { OMNIBAR_UI, RECENT_ID_PREFIX } from '@/features/command-bar/constants'
import type { Hit, HitDomain } from '@/features/command-bar/types'
import { findPref, patchPref } from '@/features/persist'

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
  const key = findPref('window').engineKey
  const known = ENGINES.some(function (engine) {
    return engine.key === key
  })
  return known ? key : ENGINES[0].key
}

async function writeEngineKey(key: string): Promise<void> {
  const engine = findEngine(key)
  await patchPref('window', { engineKey: engine.key })
}

function readRecentHits(): RecentHit[] {
  return findPref('window').recentHits.map(function (item) {
    return {
      domain: item.domain as HitDomain,
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      icon: item.icon
    }
  })
}

async function writeRecentHit(
  hit: Pick<Hit, 'domain' | 'id' | 'title' | 'subtitle' | 'icon'>
): Promise<void> {
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
  await patchPref('window', { recentHits: series })
}

export type { RecentHit }
export {
  parseEngineKey,
  readEngineKey,
  writeEngineKey,
  readRecentHits,
  writeRecentHit
}
