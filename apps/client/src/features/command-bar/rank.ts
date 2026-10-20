/**
 * 命中排序与去重（展示层唯一入口）
 */
import { DOMAIN_ORDER } from '@/features/command-bar/constants'
import type { Hit, HitDomain } from '@/features/command-bar/types'
import { uniqueByStrategies } from '@/features/command-bar/unique'

function findDomainRank(domain: HitDomain): number {
  const index = DOMAIN_ORDER.indexOf(domain)
  return index < 0 ? DOMAIN_ORDER.length : index
}

function findHitKey(hit: Hit): string {
  return `${hit.domain}:${hit.id}`
}

/** 同域同标题同副标题 → 同一展示条（不同 id 的两块「书签」磁贴也会合并） */
function findHitFace(hit: Hit): string {
  return `${hit.domain}:${hit.title}:${hit.subtitle ?? ''}`
}

/** 命中身份策略表：改去重规则只改这里 */
const HIT_IDENTITY = [findHitKey, findHitFace] as const

function uniqueHits(hits: readonly Hit[]): Hit[] {
  return uniqueByStrategies(hits, HIT_IDENTITY)
}

function sortHits(hits: readonly Hit[]): Hit[] {
  const sorted = [...hits].sort(function (left, right) {
    const domainDelta = findDomainRank(left.domain) - findDomainRank(right.domain)
    if (domainDelta !== 0) return domainDelta
    if (right.score !== left.score) return right.score - left.score
    return left.title.localeCompare(right.title, 'zh')
  })
  return uniqueHits(sorted)
}

function groupHits(hits: readonly Hit[]): Array<{ domain: HitDomain; hits: Hit[] }> {
  const buckets = new Map<HitDomain, Hit[]>()
  for (const hit of hits) {
    const list = buckets.get(hit.domain)
    if (list) list.push(hit)
    else buckets.set(hit.domain, [hit])
  }
  return DOMAIN_ORDER.filter(function (domain) {
    return buckets.has(domain)
  }).map(function (domain) {
    return { domain, hits: buckets.get(domain)! }
  })
}

function findFlatHits(hits: readonly Hit[]): Hit[] {
  return groupHits(hits).flatMap(function (group) {
    return group.hits
  })
}

export {
  findDomainRank,
  findHitKey,
  findHitFace,
  uniqueHits,
  sortHits,
  groupHits,
  findFlatHits
}
