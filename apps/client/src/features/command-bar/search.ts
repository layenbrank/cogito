/**
 * 检索编排：同步本地命中 + 异步 Web 建议合并
 */
import { openUrl } from '@tauri-apps/plugin-opener'

import { findEngine } from '@/constants/engine'
import { RECENT_ID_PREFIX } from '@/features/command-bar/constants'
import { matchesFilter, parseQuery } from '@/features/command-bar/query'
import { findInstantWebHits } from '@/features/command-bar/providers/web'
import { searchLocalProviders } from '@/features/command-bar/registry'
import { sortHits } from '@/features/command-bar/rank'
import {
  readEngineKey,
  readRecentHits,
  type RecentHit
} from '@/features/command-bar/store'
import type { DomainFilter, Hit } from '@/features/command-bar/types'
import { buildMatchUrl } from '@/features/command-bar/url'

type RecentHitRevive = Pick<RecentHit, 'domain' | 'id' | 'title'>

/** 复活最近项：优先精确命中；Web 建议等无法复活时退回当前引擎搜索标题 */
async function reviveRecentHit(item: RecentHitRevive): Promise<void> {
  const revivedLocal = searchLocalProviders(parseQuery(item.title, item.domain))
  const revivedWeb = findInstantWebHits(item.title).filter(function (hit) {
    return matchesFilter(hit.domain, item.domain)
  })
  const match =
    [...revivedLocal, ...revivedWeb].find(function (hit) {
      return hit.domain === item.domain && hit.id === item.id
    }) ??
    revivedLocal[0] ??
    revivedWeb[0]
  if (match) {
    await match.run()
    return
  }
  if (item.domain === 'web' && item.title.trim()) {
    const engine = findEngine(readEngineKey())
    await openUrl(buildMatchUrl(engine.match, item.title.trim()))
    return
  }
  console.warn('[command-bar] 最近项无法复活:', item.domain, item.id, item.title)
}

function findRecentHits(): Hit[] {
  return readRecentHits().map(function (item): Hit {
    return {
      domain: item.domain,
      id: `${RECENT_ID_PREFIX}${item.id}`,
      title: item.title,
      subtitle: item.subtitle ?? '最近',
      score: 1.1,
      icon: item.icon,
      async run() {
        await reviveRecentHit(item)
      }
    }
  })
}

function parseEntityId(hit: Hit): string {
  return hit.id.startsWith(RECENT_ID_PREFIX)
    ? hit.id.slice(RECENT_ID_PREFIX.length)
    : hit.id
}

/** 空查询：最近 + 本地；有查询：本地 + Web 即时行。去重统一走 sortHits。 */
function findSyncHits(value: string, chip: DomainFilter): Hit[] {
  const parsed = parseQuery(value, chip)
  const local = searchLocalProviders(parsed)
  const web =
    matchesFilter('web', parsed.filter) && parsed.text
      ? findInstantWebHits(parsed.text)
      : []

  if (!parsed.text && parsed.filter === 'all') {
    const recent = findRecentHits()
    const seen = new Set(
      recent.map(function (hit) {
        return `${hit.domain}:${parseEntityId(hit)}`
      })
    )
    return sortHits([
      ...recent,
      ...local.filter(function (hit) {
        return !seen.has(`${hit.domain}:${hit.id}`)
      })
    ])
  }

  return sortHits([...local, ...web])
}

/** 把防抖回来的 Bing 建议并进当前命中（去掉旧 suggest 行） */
function mergeWebSuggestions(prior: Hit[], suggestions: Hit[]): Hit[] {
  const withoutSuggest = prior.filter(function (hit) {
    return !(hit.domain === 'web' && hit.id.startsWith('suggest:'))
  })
  return sortHits([...withoutSuggest, ...suggestions])
}

function isSuggestHit(hit: Hit): boolean {
  return hit.domain === 'web' && hit.id.startsWith('suggest:')
}

export {
  findSyncHits,
  findRecentHits,
  mergeWebSuggestions,
  isSuggestHit,
  parseEntityId,
  reviveRecentHit
}
