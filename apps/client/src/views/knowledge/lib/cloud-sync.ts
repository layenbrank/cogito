/**
 * 把知识库文档传到云端并建索引（Phase 6 的写半边）。
 *
 * 三段拼起来才叫「已索引」：**上传字节**（拿到 assetID）→ **起索引任务**（服务端切块 + 嵌入）
 * → **回写状态**（`knowledge_index_state`）。中途任何一步失败都把原因写进状态行，
 * 界面据此显示「失败 + 原因」，而不是静默消失。
 *
 * 为什么由客户端驱动：上传要用户身份（JWT + 租户），索引任务要资产归属；
 * 服务端不替客户端猜「这篇文档该不该上云」。
 */
import { readFile } from '@tauri-apps/plugin-fs'

import { POST_RAG_INDEX_TASK, GET_RAG_INDEX_TASK, type RagIndexTask } from '@/apis/rag'
import { uploadAsset } from '@/apis/upload'
import { writeCloudState } from '@/lib/knowledge-ipc'
import { DICT_VALUE } from '@/shared/ipc/specs/dict'
import { reportCaught } from '@/utils/exception-report'

const CLOUD = DICT_VALUE.KNOWLEDGE_CLOUD_STATUS

/** 轮询索引任务的间隔与总预算：一份文档的索引是分钟级，但客户端不该无限等 */
const POLL_INTERVAL_MS = 1_500
const POLL_BUDGET_MS = 3 * 60 * 1_000

interface CloudSyncTarget {
  docId: string
  /** 文档绝对路径（读字节用） */
  path: string
  /** 上传时的文件名；云端按它记录来源 */
  name: string
}

interface CloudSyncResult {
  docId: string
  /** knowledge_cloud_status value */
  status: typeof CLOUD.SUCCEEDED | typeof CLOUD.FAILED
  error?: string
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(function (resolve) {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      function () {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '同步失败'
}

/** 建索引：等服务端跑到终态。`FAILED` 也是终态（重试与否由上层决定）。 */
async function awaitIndexTask(assetID: string, signal?: AbortSignal): Promise<RagIndexTask> {
  let task = await POST_RAG_INDEX_TASK(assetID)
  const deadline = Date.now() + POLL_BUDGET_MS
  while (task.status === 'RUNNING' && Date.now() < deadline && !signal?.aborted) {
    await sleep(POLL_INTERVAL_MS, signal)
    if (signal?.aborted) break
    task = await GET_RAG_INDEX_TASK(task.id)
  }
  return task
}

/**
 * 同步一篇文档：上传字节 → 建索引 → 回写状态。
 *
 * 返回结果而不抛错：批量同步时一篇失败不该中断整批，调用方按结果汇总即可。
 */
async function syncDocToCloud(
  target: CloudSyncTarget,
  signal?: AbortSignal
): Promise<CloudSyncResult> {
  try {
    const bytes = await readFile(target.path)
    const assetID = await uploadAsset({
      name: target.name,
      mime: 'text/markdown',
      bytes
    })
    // 先落「进行中 + assetID」：即使进程中途被杀，下次也知道这篇传的是哪个资产
    await writeCloudState({ docId: target.docId, status: CLOUD.RUNNING, assetId: assetID })

    const task = await awaitIndexTask(assetID, signal)
    if (task.status === 'SUCCEEDED') {
      await writeCloudState({
        docId: target.docId,
        status: CLOUD.SUCCEEDED,
        assetId: assetID,
        indexedAt: task.updatedAt
      })
      return { docId: target.docId, status: CLOUD.SUCCEEDED }
    }

    const reason = task.error ?? (signal?.aborted ? '已取消' : '索引未在预期时间内完成')
    await writeCloudState({
      docId: target.docId,
      status: CLOUD.FAILED,
      assetId: assetID,
      error: reason
    })
    return { docId: target.docId, status: CLOUD.FAILED, error: reason }
  } catch (error) {
    reportCaught('knowledge.cloudSync', error, 'warning')
    const reason = toMessage(error)
    // 状态回写本身失败时不再递归报错：日志里已经有原因了
    await writeCloudState({ docId: target.docId, status: CLOUD.FAILED, error: reason }).catch(
      function () {
        return undefined
      }
    )
    return { docId: target.docId, status: CLOUD.FAILED, error: reason }
  }
}

/** 逐篇同步（串行：服务端同一资产只允许一个任务在跑，并发只会互相 409）。 */
async function syncDocsToCloud(
  targets: CloudSyncTarget[],
  onProgress?: (done: number, total: number, last: CloudSyncResult) => void,
  signal?: AbortSignal
): Promise<CloudSyncResult[]> {
  const results: CloudSyncResult[] = []
  for (const target of targets) {
    if (signal?.aborted) break
    const result = await syncDocToCloud(target, signal)
    results.push(result)
    onProgress?.(results.length, targets.length, result)
  }
  return results
}

export { awaitIndexTask, POLL_BUDGET_MS, POLL_INTERVAL_MS, syncDocToCloud, syncDocsToCloud }
export type { CloudSyncResult, CloudSyncTarget }
