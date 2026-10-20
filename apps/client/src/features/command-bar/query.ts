/**
 * 解析前缀过滤与查询正文
 */
import { PREFIX_DOMAIN } from '@/features/command-bar/constants'
import type { DomainFilter, HitDomain } from '@/features/command-bar/types'

interface ParsedQuery {
  filter: DomainFilter
  text: string
  raw: string
}

const PREFIX_RE = /^([a-zA-Z]+):\s*(.*)$/

function parseQuery(raw: string, chip: DomainFilter = 'all'): ParsedQuery {
  const trimmed = raw.trim()
  const matched = PREFIX_RE.exec(trimmed)
  if (matched) {
    const key = matched[1].toLowerCase()
    const domain = PREFIX_DOMAIN[key]
    if (domain) {
      return {
        filter: domain,
        text: matched[2].trim(),
        raw: trimmed
      }
    }
  }
  return {
    filter: chip,
    text: trimmed,
    raw: trimmed
  }
}

function matchesFilter(domain: HitDomain, filter: DomainFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'tile') {
    return domain === 'tile' || domain === 'collection'
  }
  return domain === filter
}

export type { ParsedQuery }
export { parseQuery, matchesFilter }
