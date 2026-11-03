/**
 * raw/sources 外部变更监听：create/modify 入队；remove 走 lifecycle 清理。
 * 支持活动库实时 watch；非活动库变更写入 pending，打开后再 ingest。
 */
import { size, watch, type UnwatchFn, type WatchEvent } from '@tauri-apps/plugin-fs'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useFileSyncStore } from '@/views/knowledge/lib/file-sync-store.ts'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import {
  discardPendingForSources,
  enqueuePendingIngest
} from '@/views/knowledge/lib/pending-ingest.ts'
import { removeParsedMarkdown } from '@/views/knowledge/lib/parsed-source-output.ts'
import { deleteSourceCascade } from '@/views/knowledge/lib/source-lifecycle.ts'
import {
  isPathAllowedBySourceWatch,
  readSourceWatchConfig
} from '@/views/knowledge/lib/source-watch-config.ts'

interface WatchTarget {
  baseId: string
  rootPath: string
  isActive: boolean
}

function toRelative(root: string, absolute: string): string {
  const normalized = absolute.replace(/\\/g, '/')
  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized.toLowerCase().startsWith(rootNorm.toLowerCase() + '/')) {
    return normalized.slice(rootNorm.length + 1)
  }
  return normalized
}

function isRemoveEvent(event: WatchEvent): boolean {
  const type = event.type
  if (type && typeof type === 'object') {
    return 'remove' in type
  }
  return false
}

async function isWithinMaxSize(absolute: string, maxFileSizeMb: number): Promise<boolean> {
  try {
    const bytes = await size(absolute)
    return bytes <= maxFileSizeMb * 1024 * 1024
  } catch (error) {
    console.warn('[sources-watch] size check failed', absolute, error)
    return true
  }
}

async function watchOneSourcesDir(target: WatchTarget): Promise<UnwatchFn | null> {
  const config = readSourceWatchConfig()
  if (!config.enabled) return null

  const watchRoot = target.rootPath
  const watchTarget = joinPath(watchRoot, 'raw/sources')
  try {
    return await watch(
      watchTarget,
      function (event: WatchEvent) {
        const latest = readSourceWatchConfig()
        if (!latest.enabled) return

        const removed = isRemoveEvent(event)
        for (const path of event.paths) {
          const relative = toRelative(watchRoot, path)

          if (removed) {
            discardPendingForSources(target.baseId, [relative])
            if (target.isActive) {
              useFileSyncStore.getState().pushTask({
                kind: 'delete',
                path: relative,
                status: 'running'
              })
            }
            void deleteSourceCascade({ rootPath: watchRoot, sourceRelative: relative })
              .then(async function () {
                await removeParsedMarkdown(watchRoot, relative)
                if (target.isActive) {
                  useFileSyncStore.getState().pushTask({
                    kind: 'delete',
                    path: relative,
                    status: 'succeeded'
                  })
                  useKnowledgeStore.getState().toBumpTree()
                  void useKnowledgeBaseStore.getState().rescan()
                }
              })
              .catch(function (error) {
                console.error('[sources-watch] delete cascade failed', error)
                if (target.isActive) {
                  useFileSyncStore.getState().pushTask({
                    kind: 'delete',
                    path: relative,
                    status: 'failed',
                    error: error instanceof Error ? error.message : String(error)
                  })
                }
              })
            continue
          }

          if (!isPathAllowedBySourceWatch(path, latest)) {
            if (target.isActive) {
              useKnowledgeStore.getState().toBumpTree()
            }
            continue
          }

          if (target.isActive) {
            useKnowledgeStore.getState().toBumpTree()
            useFileSyncStore.getState().pushTask({
              kind: 'modify',
              path: relative,
              status: 'succeeded'
            })
          }

          if (!latest.autoIngest) continue

          void isWithinMaxSize(path, latest.maxFileSizeMb).then(function (ok) {
            if (!ok) {
              console.warn(
                `[sources-watch] skip oversized file (>${latest.maxFileSizeMb}MB)`,
                relative
              )
              return
            }
            if (target.isActive) {
              useIngestQueueStore.getState().enqueue(relative)
            } else {
              enqueuePendingIngest({
                baseId: target.baseId,
                rootPath: watchRoot,
                path: relative
              })
            }
          })
        }
      },
      { recursive: true, delayMs: config.delayMs }
    )
  } catch (error) {
    console.warn('[sources-watch] watch failed', watchTarget, error)
    return null
  }
}

async function watchSourcesDir(rootPath: string): Promise<UnwatchFn | null> {
  const activeId = useKnowledgeBaseStore.getState().activeBaseID
  return watchOneSourcesDir({
    baseId: activeId ?? 'active',
    rootPath,
    isActive: true
  })
}

async function watchKnowledgeBases(input: {
  bases: { id: string; rootPath: string }[]
  activeBaseId: string | null
  watchAllBases: boolean
}): Promise<() => void> {
  const config = readSourceWatchConfig()
  if (!config.enabled) return function () {}

  const targets: WatchTarget[] = []
  for (const base of input.bases) {
    if (!base.rootPath) continue
    const isActive = base.id === input.activeBaseId
    if (!isActive && !input.watchAllBases) continue
    targets.push({
      baseId: base.id,
      rootPath: base.rootPath,
      isActive
    })
  }

  const stops = await Promise.all(
    targets.map(function (target) {
      return watchOneSourcesDir(target)
    })
  )

  return function stopAll() {
    for (const stop of stops) {
      stop?.()
    }
  }
}

export { watchKnowledgeBases, watchSourcesDir }
