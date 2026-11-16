/** Command Omnibar 统一命中 */

type HitDomain =
  | 'tile'
  | 'collection'
  | 'navigation'
  | 'agent'
  | 'calendar'
  | 'reminder'
  | 'gallery'
  | 'knowledge'
  | 'file'
  | 'command'
  | 'web'

interface Hit {
  domain: HitDomain
  id: string
  title: string
  subtitle?: string
  score: number
  icon?: string
  /** 激活时执行；异步可抛错由调用方 toast */
  run: () => void | Promise<void>
  /** 可选：在文件管理器中显示（Alt+Enter），只有文件类命中提供 */
  reveal?: () => void | Promise<void>
}

interface SearchProvider {
  domain: HitDomain
  /** 空查询时是否仍返回结果（如 recent / 快捷入口） */
  search: (query: string, signal: AbortSignal) => Promise<Hit[]> | Hit[]
}

type DomainFilter = 'all' | HitDomain

export type { DomainFilter, Hit, HitDomain, SearchProvider }
