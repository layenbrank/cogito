/**
 * Agent 浏览器本地访问历史（跨会话）。
 *
 * 记在 `window.json` 的 `browserVisits`：导航成功 / SPA 同文档变更时写入，
 * omnibox 用作「历史」建议源。不含 WebView2 配置文件 History DB。
 */
import { BROWSER_VISIT_CAP } from '@/features/persist/defaults'
import { findPref, patchPref } from '@/features/persist'
import type { BrowserVisit } from '@/features/persist/types'

const SKIP_URLS = new Set(['', 'about:blank'])

function normalizeVisitUrl(url: string): string {
  return url.trim()
}

function readBrowserVisits(): BrowserVisit[] {
  return findPref('window').browserVisits ?? []
}

async function recordBrowserVisit(url: string, title?: string | null): Promise<void> {
  const normalized = normalizeVisitUrl(url)
  if (!normalized || SKIP_URLS.has(normalized)) return

  const visitedAt = Date.now()
  const nextTitle = title?.trim() || normalized
  const prior = readBrowserVisits().filter(function (item) {
    return item.url !== normalized
  })
  const next: BrowserVisit[] = [
    { url: normalized, title: nextTitle, visitedAt },
    ...prior
  ].slice(0, BROWSER_VISIT_CAP)

  try {
    await patchPref('window', { browserVisits: next })
  } catch (error) {
    console.warn('[browser/visit-history] 写入访问记录失败:', error)
  }
}

function matchBrowserVisits(query: string, limit = 6): BrowserVisit[] {
  const visits = readBrowserVisits()
  const needle = query.trim().toLowerCase()
  if (!needle) return visits.slice(0, limit)

  const scored: Array<{ visit: BrowserVisit; score: number }> = []
  for (const visit of visits) {
    const url = visit.url.toLowerCase()
    const title = visit.title.toLowerCase()
    if (!url.includes(needle) && !title.includes(needle)) continue
    // 前缀 / 越靠前越靠谱
    let score = 0
    if (title.startsWith(needle) || url.startsWith(needle)) score += 2
    if (title.includes(needle)) score += 1
    if (url.includes(needle)) score += 1
    scored.push({ visit, score })
  }
  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score
    return b.visit.visitedAt - a.visit.visitedAt
  })
  return scored.slice(0, limit).map(function (item) {
    return item.visit
  })
}

export { matchBrowserVisits, readBrowserVisits, recordBrowserVisit }
