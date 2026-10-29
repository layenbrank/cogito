import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.fn(function () {
  return Promise.resolve(new Uint8Array([1, 2, 3]))
})
const uploadAsset = vi.fn(function () {
  return Promise.resolve('asset-1')
})
const POST_RAG_INDEX_TASK = vi.fn()
const GET_RAG_INDEX_TASK = vi.fn()
const writeCloudState = vi.fn(function (params: { status: string }) {
  return Promise.resolve({
    docId: 'd1',
    status: params.status,
    assetId: null,
    indexedAt: null,
    error: null
  })
})

vi.mock('@tauri-apps/plugin-fs', function () {
  return { readFile }
})
vi.mock('@/apis/upload', function () {
  return { uploadAsset }
})
vi.mock('@/apis/rag', function () {
  return { GET_RAG_INDEX_TASK, POST_RAG_INDEX_TASK }
})
vi.mock('@/lib/knowledge-ipc', function () {
  return { writeCloudState }
})

const { DICT_VALUE } = await import('@/shared/ipc/specs/dict')
const { syncDocToCloud } = await import('@/views/knowledge/lib/cloud-sync.ts')
const CLOUD = DICT_VALUE.KNOWLEDGE_CLOUD_STATUS

function task(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    assetID: 'asset-1',
    status,
    progress: null,
    result: null,
    error: null,
    createdAt: 1,
    updatedAt: 2,
    ...extra
  }
}

const TARGET = { docId: 'd1', path: '/lib/一篇.md', name: '一篇.md' }

beforeEach(function () {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(function () {
  vi.useRealTimers()
})

describe('syncDocToCloud', function () {
  it('上传 → 等索引到终态 → 回写 succeeded', async function () {
    POST_RAG_INDEX_TASK.mockResolvedValue(task('RUNNING'))
    GET_RAG_INDEX_TASK.mockResolvedValue(task('SUCCEEDED', { updatedAt: 42 }))

    const running = syncDocToCloud(TARGET)
    await vi.runAllTimersAsync()
    const result = await running

    expect(result).toEqual({ docId: 'd1', status: CLOUD.SUCCEEDED })
    expect(uploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({ name: '一篇.md', mime: 'text/markdown' })
    )
    // 先落「进行中 + assetID」，再收尾写 succeeded
    expect(writeCloudState).toHaveBeenNthCalledWith(1, {
      docId: 'd1',
      status: CLOUD.RUNNING,
      assetId: 'asset-1'
    })
    expect(writeCloudState).toHaveBeenLastCalledWith({
      docId: 'd1',
      status: CLOUD.SUCCEEDED,
      assetId: 'asset-1',
      indexedAt: 42
    })
  })

  it('索引判失败时把原因写进状态行', async function () {
    POST_RAG_INDEX_TASK.mockResolvedValue(task('FAILED', { error: 'embedding 超时' }))

    const result = await syncDocToCloud(TARGET)

    expect(result).toEqual({
      docId: 'd1',
      status: CLOUD.FAILED,
      error: 'embedding 超时'
    })
    expect(writeCloudState).toHaveBeenLastCalledWith({
      docId: 'd1',
      status: CLOUD.FAILED,
      assetId: 'asset-1',
      error: 'embedding 超时'
    })
  })

  it('上传本身失败也回写 failed，且不抛错（批量同步不该被一篇拖垮）', async function () {
    uploadAsset.mockRejectedValueOnce(new Error('分片大小须在 10MB 至 100MB 之间'))

    const result = await syncDocToCloud(TARGET)

    expect(result.status).toBe(CLOUD.FAILED)
    expect(result.error).toContain('10MB')
    expect(writeCloudState).toHaveBeenCalledTimes(1)
    expect(writeCloudState).toHaveBeenCalledWith(
      expect.objectContaining({ docId: 'd1', status: CLOUD.FAILED })
    )
  })
})
