/**
 * 搜索关键词 / 建议 URL 解析
 */
import type { SearchEngine } from '@/constants/engine'
import { ENGINE_UI } from '@/views/browser/engine/engine-constants'

interface SuggestionItem {
  q: string
  u: string
}

function parseSuggestionLabel(q: string) {
  return q.replace(ENGINE_UI.PRIVATE_USE_CHARS, '')
}

function isUrlKeyword(value: string) {
  const text = value.trim()
  if (!text || /\s/.test(text)) return false
  return ENGINE_UI.URL_PATTERN.test(text)
}

function parseKeywordUrl(value: string) {
  const text = value.trim()
  if (/^https?:\/\//i.test(text)) return text
  return `https://${text}`
}

function buildSuggestionUrl(origin: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path
  const base = origin.replace(/\/$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

function buildMatchUrl(match: string, keyword: string) {
  return `${match}${encodeURIComponent(keyword)}`
}

/** 像网址就打开，否则把关键词 encodeURIComponent 后拼到当前引擎的搜索地址 */
function findAddressUrl(value: string, match: string) {
  const text = value.trim()
  if (!text) return ''
  if (isUrlKeyword(text)) return parseKeywordUrl(text)
  return `${match}${encodeURIComponent(text)}`
}

function findItemUrl(engine: SearchEngine, item: SuggestionItem) {
  if (engine.key === 'bing') return buildSuggestionUrl(engine.origin, item.u)
  return buildMatchUrl(engine.match, parseSuggestionLabel(item.q))
}

function findDefaultNavigation(value: string) {
  return isUrlKeyword(value) ? ENGINE_UI.NONE : 0
}

export {
  parseSuggestionLabel,
  isUrlKeyword,
  parseKeywordUrl,
  buildSuggestionUrl,
  buildMatchUrl,
  findAddressUrl,
  findItemUrl,
  findDefaultNavigation
}
