/**
 * AnyTXT JSON-RPC 本地检索（默认 http://127.0.0.1:9920）。
 */
import {
  readAnyTxtConfig,
  type AnyTxtConfig
} from '@/views/knowledge/lib/anytxt-config.ts'

interface AnyTxtHit {
  title: string
  url: string
  snippet: string
  path: string
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (!trimmed) return 'http://127.0.0.1:9920'
  if (/\/ATRpcServer\.Searcher\.V1\.GetResult$/i.test(trimmed)) {
    return trimmed.replace(/\/ATRpcServer\.Searcher\.V1\.GetResult$/i, '')
  }
  return trimmed
}

function fileUrlForPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${normalized}`
  }
  if (normalized.startsWith('/')) return `file://${normalized}`
  return `file:///${normalized}`
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function extractItems(value: unknown): { title: string; path: string; snippet: string }[] {
  if (!value || typeof value !== 'object') return []
  const root = value as Record<string, unknown>
  const result = (root.result ?? root) as Record<string, unknown>
  const candidates =
    (result.files as unknown[]) ||
    (result.items as unknown[]) ||
    (result.list as unknown[]) ||
    (Array.isArray(result) ? result : [])
  if (!Array.isArray(candidates)) return []
  return candidates
    .map(function (item) {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const path = asText(row.path) || asText(row.filePath) || asText(row.fullPath)
      if (!path) return null
      const title = asText(row.title) || asText(row.name) || path.split(/[/\\]/).pop() || path
      const snippet = asText(row.snippet) || asText(row.fragment) || asText(row.preview)
      return { title, path, snippet }
    })
    .filter(function (item): item is { title: string; path: string; snippet: string } {
      return item !== null
    })
}

async function anyTxtSearch(
  query: string,
  configOverride?: Partial<AnyTxtConfig>,
  maxResults?: number
): Promise<AnyTxtHit[]> {
  const config = { ...readAnyTxtConfig(), ...configOverride }
  if (!config.enabled) return []
  const q = query.trim()
  if (!q) return []

  const endpoint = normalizeEndpoint(config.endpoint)
  const limit = Math.min(config.limit, maxResults ?? config.limit)
  const input: Record<string, unknown> = {
    pattern: q,
    filterExt: config.filterExt || '*',
    lastModifyBegin: 0,
    lastModifyEnd: 4_102_444_800,
    limit: String(limit),
    offset: 0,
    order: 0
  }
  if (config.filterDir.trim()) {
    input.filterDir = config.filterDir.trim()
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'ATRpcServer.Searcher.V1.GetResult',
      params: { input }
    })
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`AnyTXT HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`AnyTXT 返回非 JSON：${text.slice(0, 200)}`)
  }
  const err = (value as { error?: unknown })?.error
  if (err) {
    throw new Error(`AnyTXT error: ${JSON.stringify(err).slice(0, 200)}`)
  }

  return extractItems(value)
    .slice(0, limit)
    .map(function (item) {
      return {
        title: item.title,
        path: item.path,
        snippet: item.snippet,
        url: fileUrlForPath(item.path)
      }
    })
}

export { anyTxtSearch, normalizeEndpoint }
export type { AnyTxtHit }
