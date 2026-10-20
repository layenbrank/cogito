/**
 * Provider 注册表 + 本地同步检索
 */
import { matchesFilter, type ParsedQuery } from '@/features/command-bar/query'
import { sortHits } from '@/features/command-bar/rank'
import type { Hit, HitDomain, SearchProvider } from '@/features/command-bar/types'

/** domain → provider；同 domain 后写覆盖，天然幂等（抗 HMR） */
const PROVIDERS = new Map<HitDomain, SearchProvider>()

function registerProvider(provider: SearchProvider): void {
  PROVIDERS.set(provider.domain, provider)
}

function bootstrapProviders(providers: readonly SearchProvider[]): void {
  for (const provider of providers) {
    registerProvider(provider)
  }
}

function findProviders(
  parsed: ParsedQuery,
  options?: { excludeWeb?: boolean }
): SearchProvider[] {
  const next: SearchProvider[] = []
  for (const provider of PROVIDERS.values()) {
    if (options?.excludeWeb && provider.domain === 'web') continue
    if (!matchesFilter(provider.domain, parsed.filter)) continue
    next.push(provider)
  }
  return next
}

function parseLocalHits(
  provider: SearchProvider,
  query: string,
  filter: ParsedQuery['filter']
): Hit[] {
  try {
    const result = provider.search(query, new AbortController().signal)
    if (result instanceof Promise) {
      console.warn('[command-bar] local provider 返回了 Promise:', provider.domain)
      return []
    }
    return result.filter(function (hit) {
      return matchesFilter(hit.domain, filter)
    })
  } catch (error) {
    console.error('[command-bar] local provider 失败:', provider.domain, error)
    return []
  }
}

/** 本地域同步检索（不含 Web IPC） */
function searchLocalProviders(parsed: ParsedQuery): Hit[] {
  const hits: Hit[] = []
  for (const provider of findProviders(parsed, { excludeWeb: true })) {
    hits.push(...parseLocalHits(provider, parsed.text, parsed.filter))
  }
  return sortHits(hits)
}

function readProviders(): readonly SearchProvider[] {
  return [...PROVIDERS.values()]
}

export {
  registerProvider,
  bootstrapProviders,
  searchLocalProviders,
  readProviders
}
