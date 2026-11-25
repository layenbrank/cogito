/**
 * 非活动知识库的后台 watch 入队缓冲：打开对应库时再 drain 进 ingest 队列。
 * 对齐 llm_wiki enqueueInactiveProjectBatch。
 */
const STORAGE_KEY = 'knowledge.source-watch.pending-ingest'

interface PendingIngestEntry {
  spaceId: string
  rootPath: string
  paths: string[]
}

function readAll(): PendingIngestEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(function (item): item is PendingIngestEntry {
      if (!item || typeof item !== 'object') return false
      const row = item as Record<string, unknown>
      return (
        typeof row.spaceId === 'string' &&
        typeof row.rootPath === 'string' &&
        Array.isArray(row.paths)
      )
    })
  } catch (error) {
    console.warn('[pending-ingest] read failed', error)
    return []
  }
}

function writeAll(entries: PendingIngestEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.warn('[pending-ingest] write failed', error)
  }
}

function enqueuePendingIngest(input: {
  spaceId: string
  rootPath: string
  path: string
}): void {
  const trimmed = input.path.trim().replace(/\\/g, '/')
  if (!trimmed) return
  const entries = readAll()
  let entry = entries.find(function (item) {
    return item.spaceId === input.spaceId
  })
  if (!entry) {
    entry = { spaceId: input.spaceId, rootPath: input.rootPath, paths: [] }
    entries.push(entry)
  }
  entry.rootPath = input.rootPath
  if (!entry.paths.includes(trimmed)) {
    entry.paths.push(trimmed)
  }
  writeAll(entries)
}

function discardPendingForSources(spaceId: string, paths: string[]): void {
  const needles = new Set(
    paths.map(function (path) {
      return path.replace(/\\/g, '/')
    })
  )
  const entries = readAll()
    .map(function (entry) {
      if (entry.spaceId !== spaceId) return entry
      return {
        ...entry,
        paths: entry.paths.filter(function (path) {
          return !needles.has(path.replace(/\\/g, '/'))
        })
      }
    })
    .filter(function (entry) {
      return entry.paths.length > 0
    })
  writeAll(entries)
}

function takePendingForSpace(spaceId: string): PendingIngestEntry | null {
  const entries = readAll()
  const entry = entries.find(function (item) {
    return item.spaceId === spaceId
  })
  if (!entry) return null
  writeAll(
    entries.filter(function (item) {
      return item.spaceId !== spaceId
    })
  )
  return entry
}

export {
  discardPendingForSources,
  enqueuePendingIngest,
  takePendingForSpace
}
export type { PendingIngestEntry }
