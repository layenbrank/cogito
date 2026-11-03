/**
 * 非活动知识库的后台 watch 入队缓冲：打开对应库时再 drain 进 ingest 队列。
 * 对齐 llm_wiki enqueueInactiveProjectBatch。
 */
const STORAGE_KEY = 'knowledge.source-watch.pending-ingest'

interface PendingIngestEntry {
  baseId: string
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
      return (
        item &&
        typeof item === 'object' &&
        typeof (item as PendingIngestEntry).baseId === 'string' &&
        typeof (item as PendingIngestEntry).rootPath === 'string' &&
        Array.isArray((item as PendingIngestEntry).paths)
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
  baseId: string
  rootPath: string
  path: string
}): void {
  const trimmed = input.path.trim().replace(/\\/g, '/')
  if (!trimmed) return
  const entries = readAll()
  let entry = entries.find(function (item) {
    return item.baseId === input.baseId
  })
  if (!entry) {
    entry = { baseId: input.baseId, rootPath: input.rootPath, paths: [] }
    entries.push(entry)
  }
  entry.rootPath = input.rootPath
  if (!entry.paths.includes(trimmed)) {
    entry.paths.push(trimmed)
  }
  writeAll(entries)
}

function discardPendingForSources(baseId: string, paths: string[]): void {
  const needles = new Set(
    paths.map(function (path) {
      return path.replace(/\\/g, '/')
    })
  )
  const entries = readAll()
    .map(function (entry) {
      if (entry.baseId !== baseId) return entry
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

function takePendingForBase(baseId: string): PendingIngestEntry | null {
  const entries = readAll()
  const entry = entries.find(function (item) {
    return item.baseId === baseId
  })
  if (!entry) return null
  writeAll(
    entries.filter(function (item) {
      return item.baseId !== baseId
    })
  )
  return entry
}

export {
  discardPendingForSources,
  enqueuePendingIngest,
  takePendingForBase
}
export type { PendingIngestEntry }
