/**
 * Ingest 增量缓存：按源文件 SHA-256 跳过已处理资料。
 */
const CACHE_KEY = 'knowledge.ingest.sha-cache'

interface IngestCacheEntry {
  sha256: string
  relative: string
  wikiPath: string
  processedAt: number
}

type IngestCacheMap = Record<string, IngestCacheEntry>

async function digestSha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)]
    .map(function (byte) {
      return byte.toString(16).padStart(2, '0')
    })
    .join('')
}

function readIngestCache(): IngestCacheMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as IngestCacheMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    console.warn('[ingest-cache] read failed', error)
    return {}
  }
}

function writeIngestCache(map: IngestCacheMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch (error) {
    console.warn('[ingest-cache] write failed', error)
  }
}

function findCacheByPath(relative: string): IngestCacheEntry | null {
  return readIngestCache()[relative] ?? null
}

function findCacheBySha(sha256: string): IngestCacheEntry | null {
  const map = readIngestCache()
  for (const entry of Object.values(map)) {
    if (entry.sha256 === sha256) return entry
  }
  return null
}

function rememberIngest(entry: IngestCacheEntry): void {
  const map = readIngestCache()
  map[entry.relative] = entry
  writeIngestCache(map)
}

function removeFromIngestCache(relative: string): void {
  const map = readIngestCache()
  const key = relative.replace(/\\/g, '/')
  if (!(key in map)) {
    for (const existing of Object.keys(map)) {
      if (existing.replace(/\\/g, '/') === key) {
        delete map[existing]
        writeIngestCache(map)
        return
      }
    }
    return
  }
  delete map[key]
  writeIngestCache(map)
}

export {
  CACHE_KEY,
  digestSha256,
  findCacheByPath,
  findCacheBySha,
  readIngestCache,
  rememberIngest,
  removeFromIngestCache,
  writeIngestCache
}
export type { IngestCacheEntry }
