/**
 * raw/sources 外部变更监听：create/modify 入队；remove 走 lifecycle 清理。
 * 支持活动库实时 watch；非活动库变更写入 pending，打开后再 ingest。
 */
import { size, watch, type UnwatchFn, type WatchEvent } from '@tauri-apps/plugin-fs'

import { useSpacesStore } from '@/stores/spaces'
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
  spaceId: string
  rootPath: string
  isActive: boolean
}

/**
 * 整树重建的合并窗口。
 *
 * 拖一批资料进 `raw/sources` 时，watch 是**逐文件**回调的：原来每个事件都
 * `toBumpTree()` → 清空目录缓存 + 整树重新 readDir。批量导入 200 个文件就是 200 次。
 */
const TREE_BUMP_DELAY_MS = 400
let treeBumpTimer: number | null = null

function scheduleTreeBump(): void {
  if (treeBumpTimer !== null) return
  treeBumpTimer = window.setTimeout(function () {
    treeBumpTimer = null
    useKnowledgeStore.getState().toBumpTree()
  }, TREE_BUMP_DELAY_MS)
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
            discardPendingForSources(target.spaceId, [relative])
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
                  scheduleTreeBump()
                  void useSpacesStore.getState().rescan()
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
              scheduleTreeBump()
            }
            continue
          }

          if (target.isActive) {
            scheduleTreeBump()
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
                spaceId: target.spaceId,
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
  const activeId = useSpacesStore.getState().activeSpaceID
  return watchOneSourcesDir({
    spaceId: activeId ?? 'active',
    rootPath,
    isActive: true
  })
}

async function watchKnowledgeSpaces(input: {
  spaces: { id: string; rootPath: string }[]
  activeSpaceId: string | null
  watchAllBases: boolean
}): Promise<() => void> {
  const config = readSourceWatchConfig()
  if (!config.enabled) return function () {}

  const targets: WatchTarget[] = []
  for (const space of input.spaces) {
    if (!space.rootPath) continue
    const isActive = space.id === input.activeSpaceId
    if (!isActive && !input.watchAllBases) continue
    targets.push({
      spaceId: space.id,
      rootPath: space.rootPath,
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
      try {
        const result = stop?.() as void | Promise<void>
        if (result && typeof result.then === 'function') {
          void result.catch(function (error) {
            console.warn('[sources-watch] unwatch failed', error)
          })
        }
      } catch (error) {
        console.warn('[sources-watch] unwatch failed', error)
      }
    }
  }
}

export { watchKnowledgeSpaces, watchSourcesDir }
