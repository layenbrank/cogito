/**
 * 知识入库队列（localStorage 持久化）+ 串行 runNext。
 * ACP 不可用时任务标 blocked（对标 llm_wiki blockedOnLlmConfig）。
 */
import { create } from 'zustand'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { isAcpIngestReady } from '@/views/knowledge/lib/ingest-acp-analyzer.ts'
import { hasRegisteredIngestAnalyzer } from '@/views/knowledge/lib/ingest-analyze.ts'
import { runIngest } from '@/views/knowledge/lib/ingest-runner.ts'
import { readSourceWatchConfig } from '@/views/knowledge/lib/source-watch-config.ts'
import { sweepReviewsOnDrain } from '@/views/knowledge/lib/sweep-reviews.ts'

const QUEUE_STORAGE_KEY = 'knowledge.ingest.queue'

type IngestStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'blocked'

interface IngestQueueItem {
  id: string
  path: string
  status: IngestStatus
  error?: string
  attempts: number
  wikiPath?: string
}

interface IngestQueueState {
  items: IngestQueueItem[]
  isPaused: boolean
  enqueue: (path: string) => string
  cancel: (id: string) => void
  retry: (id: string) => void
  pause: () => void
  resume: () => void
  retryAllFailed: () => void
  bootstrap: () => void
  runNext: () => Promise<void>
  unblockReady: () => Promise<void>
}

function readQueueFromStorage(): IngestQueueItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(function (item): item is IngestQueueItem {
      return (
        item &&
        typeof item === 'object' &&
        typeof (item as IngestQueueItem).id === 'string' &&
        typeof (item as IngestQueueItem).path === 'string'
      )
    })
  } catch (error) {
    console.warn('[knowledge/ingest] 读取队列失败', error)
    return []
  }
}

function writeQueueToStorage(items: IngestQueueItem[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items))
  } catch (error) {
    console.warn('[knowledge/ingest] 写入队列失败', error)
  }
}

function patchItem(
  items: IngestQueueItem[],
  id: string,
  patch: Partial<IngestQueueItem>
): IngestQueueItem[] {
  return items.map(function (item) {
    if (item.id !== id) return item
    return { ...item, ...patch }
  })
}

function findActiveRootPath(): string | null {
  const state = useKnowledgeBaseStore.getState()
  const base = state.bases.find(function (item) {
    return item.id === state.activeBaseID
  })
  return base?.rootPath ?? null
}

function countRunning(items: IngestQueueItem[]): number {
  return items.filter(function (item) {
    return item.status === 'running'
  }).length
}

const useIngestQueueStore = create<IngestQueueState>(function (set, get) {
  return {
    items: [],
    isPaused: false,

    bootstrap: function () {
      set({ items: readQueueFromStorage() })
    },

    pause: function () {
      set({ isPaused: true })
    },

    resume: function () {
      set({ isPaused: false })
      void get().runNext()
    },

    retryAllFailed: function () {
      set(function (state) {
        const items = state.items.map(function (item) {
          if (item.status !== 'failed' && item.status !== 'blocked' && item.status !== 'cancelled') {
            return item
          }
          return { ...item, status: 'pending' as const, error: undefined, attempts: item.attempts + 1 }
        })
        writeQueueToStorage(items)
        return { items }
      })
      void get().runNext()
    },

    enqueue: function (path) {
      const trimmed = path.trim()
      if (!trimmed) return ''
      const dup = get().items.find(function (item) {
        return (
          item.path === trimmed &&
          (item.status === 'pending' ||
            item.status === 'running' ||
            item.status === 'blocked')
        )
      })
      if (dup) return dup.id

      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `ingest-${Date.now()}`
      const item: IngestQueueItem = {
        id,
        path: trimmed,
        status: 'pending',
        attempts: 0
      }
      set(function (state) {
        const items = [...state.items, item]
        writeQueueToStorage(items)
        return { items }
      })
      void get().runNext()
      return id
    },

    cancel: function (id) {
      set(function (state) {
        const items = patchItem(state.items, id, { status: 'cancelled' })
        writeQueueToStorage(items)
        return { items }
      })
    },

    retry: function (id) {
      set(function (state) {
        const current = state.items.find(function (item) {
          return item.id === id
        })
        const items = patchItem(state.items, id, {
          status: 'pending',
          error: undefined,
          attempts: (current?.attempts ?? 0) + 1
        })
        writeQueueToStorage(items)
        return { items }
      })
      void get().runNext()
    },

    unblockReady: async function () {
      const ready = !hasRegisteredIngestAnalyzer() || (await isAcpIngestReady())
      if (!ready) return
      set(function (state) {
        const items = state.items.map(function (item) {
          if (item.status !== 'blocked') return item
          return { ...item, status: 'pending' as const, error: undefined }
        })
        writeQueueToStorage(items)
        return { items }
      })
      void get().runNext()
    },

    runNext: async function () {
      if (get().isPaused) return

      const concurrency = Math.max(1, readSourceWatchConfig().ingestConcurrency)
      if (countRunning(get().items) >= concurrency) return

      const next = get().items.find(function (item) {
        return item.status === 'pending'
      })
      if (!next) return

      if (hasRegisteredIngestAnalyzer()) {
        const ready = await isAcpIngestReady()
        if (!ready) {
          set(function (state) {
            const items = patchItem(state.items, next.id, {
              status: 'blocked',
              error: 'ACP/模型未就绪，请配置供应商后重试'
            })
            writeQueueToStorage(items)
            return { items }
          })
          // 继续看下一条 pending（可能不应全部卡住同因；P0 全部标 blocked）
          const rest = get().items.filter(function (item) {
            return item.status === 'pending'
          })
          for (const item of rest) {
            set(function (state) {
              const items = patchItem(state.items, item.id, {
                status: 'blocked',
                error: 'ACP/模型未就绪，请配置供应商后重试'
              })
              writeQueueToStorage(items)
              return { items }
            })
          }
          return
        }
      }

      set(function (state) {
        const items = patchItem(state.items, next.id, { status: 'running' })
        writeQueueToStorage(items)
        return { items }
      })

      const rootPath = findActiveRootPath()
      if (!rootPath) {
        set(function (state) {
          const items = patchItem(state.items, next.id, {
            status: 'failed',
            error: '无活动知识库'
          })
          writeQueueToStorage(items)
          return { items }
        })
        void get().runNext()
        return
      }

      try {
        const result = await runIngest({ rootPath, path: next.path })
        set(function (state) {
          const items = patchItem(state.items, next.id, {
            status: result.skipped ? 'skipped' : 'succeeded',
            wikiPath: result.wikiPath,
            error: result.reason
          })
          writeQueueToStorage(items)
          return { items }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[knowledge/ingest] runNext failed', error)
        set(function (state) {
          const items = patchItem(state.items, next.id, {
            status: 'failed',
            error: message
          })
          writeQueueToStorage(items)
          return { items }
        })
      }

      const stillPending = get().items.some(function (item) {
        return item.status === 'pending' || item.status === 'running'
      })
      if (!stillPending) {
        void sweepReviewsOnDrain()
      }
      void get().runNext()
    }
  }
})

export { QUEUE_STORAGE_KEY, useIngestQueueStore }
export type { IngestQueueItem, IngestStatus, IngestQueueState }
