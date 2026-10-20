/**
 * 检索编排：同步本地命中 + 异步 Web 建议合并
 */
import { RECENT_ID_PREFIX } from '@/features/command-bar/constants'
import { matchesFilter, parseQuery } from '@/features/command-bar/query'
import { findInstantWebHits } from '@/features/command-bar/providers/web'
import { searchLocalProviders } from '@/features/command-bar/registry'
import { sortHits } from '@/features/command-bar/rank'
import { readRecentHits } from '@/features/command-bar/store'
import type { DomainFilter, Hit } from '@/features/command-bar/types'

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
        const revivedLocal = searchLocalProviders(
          parseQuery(item.title, item.domain)
        )
        const revivedWeb = findInstantWebHits(item.title).filter(function (hit) {
          return matchesFilter(hit.domain, item.domain)
        })
        const match =
          [...revivedLocal, ...revivedWeb].find(function (hit) {
            return hit.domain === item.domain && hit.id === item.id
          }) ?? revivedLocal[0]
        if (match) await match.run()
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
  parseEntityId
}
