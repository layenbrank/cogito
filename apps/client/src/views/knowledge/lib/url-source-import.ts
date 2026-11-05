/**
 * URL 批量导入 raw/sources（SSRF 防护、最多 50 条）。对标 llm_wiki url-source-import。
 */
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'

import { joinPath } from '@/views/knowledge/lib/path.ts'
import { WIKI_DIR_RAW_SOURCES } from '@/views/knowledge/lib/wiki-scaffold.ts'

const MAX_BATCH_URLS = 50
const MAX_REDIRECTS = 10

interface UrlImportResult {
  url: string
  path?: string
  error?: string
}

function parseImportUrls(input: string): string[] {
  const unique = new Set<string>()
  for (const line of input.split(/\r?\n/)) {
    const candidate = line.trim()
    if (!candidate) continue
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      throw new Error(`无效 URL：${candidate}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`不支持的协议：${candidate}`)
    }
    if (parsed.username || parsed.password) {
      throw new Error(`不允许带凭据的 URL：${candidate}`)
    }
    parsed.hash = ''
    unique.add(parsed.toString())
    if (unique.size > MAX_BATCH_URLS) {
      throw new Error(`单批最多 ${MAX_BATCH_URLS} 条 URL`)
    }
  }
  return [...unique]
}

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::' || host === '::1' || /^(?:fc|fd|fe[89ab])/i.test(host)) return true
  if (host.startsWith('::ffff:')) {
    const mapped = host.slice(7)
    if (mapped.includes('.')) return isPrivateNetworkHost(mapped)
  }
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(function (part) {
    return !Number.isInteger(part) || part < 0 || part > 255
  })) {
    return false
  }
  const a = parts[0]
  const b = parts[1]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function validateHttpUrl(value: string): URL {
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`不支持的协议：${value}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`不允许带凭据的 URL：${value}`)
  }
  if (isPrivateNetworkHost(parsed.hostname)) {
    throw new Error(`拒绝私网/本地地址：${value}`)
  }
  return parsed
}

async function fetchImportUrl(
  fetchImpl: typeof globalThis.fetch,
  initialUrl: string,
  signal?: AbortSignal
): Promise<Response> {
  let current = validateHttpUrl(initialUrl)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetchImpl(current.toString(), {
      redirect: 'manual',
      signal
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    if (redirects === MAX_REDIRECTS) throw new Error(`重定向过多（>${MAX_REDIRECTS}）`)
    const location = response.headers.get('location')
    if (!location) throw new Error('重定向缺少 Location')
    const next = validateHttpUrl(new URL(location, current).toString())
    current = next
  }
  throw new Error(`重定向过多（>${MAX_REDIRECTS}）`)
}

function safeSlug(value: string): string {
  const slug = value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || `url-${Date.now()}`
}

async function importUrlsToSources(input: {
  rootPath: string
  urlsText: string
  signal?: AbortSignal
}): Promise<UrlImportResult[]> {
  const urls = parseImportUrls(input.urlsText)
  const sourcesRoot = joinPath(input.rootPath, WIKI_DIR_RAW_SOURCES)
  if (!(await exists(sourcesRoot))) {
    await mkdir(sourcesRoot, { recursive: true })
  }

  const results: UrlImportResult[] = []
  for (const url of urls) {
    try {
      const response = await fetchImportUrl(globalThis.fetch, url, input.signal)
      if (!response.ok) {
        results.push({ url, error: `HTTP ${response.status}` })
        continue
      }
      const contentType = response.headers.get('content-type') || ''
      const body = await response.text()
      const host = new URL(url).hostname
      const name = `${safeSlug(host)}-${Date.now()}.md`
      const relative = `${WIKI_DIR_RAW_SOURCES}/${name}`
      const absolute = joinPath(input.rootPath, relative)
      const markdown = `---\ntitle: ${JSON.stringify(url)}\nsource_url: ${JSON.stringify(url)}\n---\n\n# ${url}\n\n> content-type: ${contentType}\n\n${body.slice(0, 200_000)}\n`
      await writeTextFile(absolute, markdown)
      results.push({ url, path: relative })
    } catch (error) {
      console.error('[url-import] failed', url, error)
      results.push({
        url,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return results
}

export {
  MAX_BATCH_URLS,
  fetchImportUrl,
  importUrlsToSources,
  isPrivateNetworkHost,
  parseImportUrls
}
export type { UrlImportResult }
