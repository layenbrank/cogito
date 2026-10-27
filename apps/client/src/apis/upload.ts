/**
 * 分片上传（cogito `/api/v1/upload/*`）。
 *
 * 服务端的模型是「prepare → 分片（可并行算 hash）→ 绑定 hash → finalize」：
 * 分片进全局 CAS，同 hash 的字节任意用户复用；finalize 只校验、不合并落盘。
 *
 * 知识库文档都是几 KB 级，这里刻意**先算 hash 再 prepare**：整文件秒传能命中时
 * 连分片都不用传（同一篇文档重新同步就是这条路径）。
 */
import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

/** 服务端要求分片 10MB–100MB；小文件就是一个分片，所以取下限 */
const CHUNK_SIZE = 10 * 1024 * 1024

interface PrepareResult {
  id: string
  /** 整文件秒传：已有 COMPLETED 资产（后续 finalize 仍要走，拿到同一个 id） */
  exists: boolean
  /** 需要上传的分片序号 */
  chunks: number[]
  uploaded: { index: number; hash: string }[]
}

interface FinalizeResult {
  success: boolean
  id: string
  url: string
}

/** 整文件的 SHA-256（小写 hex）：秒传与 finalize 校验都用它 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // 复制成独立的 ArrayBuffer 再摘要：`Uint8Array` 可能是 SharedArrayBuffer 视图，
  // 而 `crypto.subtle.digest` 只收普通 BufferSource
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return Array.from(new Uint8Array(digest))
    .map(function (byte) {
      return byte.toString(16).padStart(2, '0')
    })
    .join('')
}

function POST_PREPARE(params: {
  name: string
  size: number
  mime: string
  hash: string
}): Promise<PrepareResult> {
  return http
    .post<RSF<PrepareResult>>(
      '/upload/prepare',
      { ...params, chunk: CHUNK_SIZE },
      { env: 'cogito' }
    )
    .then(HttpEnvelope)
}

async function POST_CHUNK(params: {
  id: string
  index: number
  hash: string
  bytes: Uint8Array
}): Promise<void> {
  const form = new FormData()
  form.append('id', params.id)
  form.append('index', String(params.index))
  form.append('hash', params.hash)
  form.append(
    'chunk',
    new Blob([params.bytes as unknown as BlobPart], { type: 'application/octet-stream' }),
    `chunk-${params.index}.part`
  )
  await http.post<RSF<unknown>>('/upload/chunk', form, { env: 'cogito' }).then(HttpEnvelope)
}

function POST_FINALIZE(id: string): Promise<FinalizeResult> {
  return http.post<RSF<FinalizeResult>>('/upload/finalize', { id }, { env: 'cogito' }).then(HttpEnvelope)
}

/**
 * 上传一份字节，返回资产 id（可直接拿去建索引）。
 *
 * 失败时抛 `HttpException`：服务端对「大小/分片不合法」回的是业务码，重试没意义。
 */
async function uploadAsset(params: {
  name: string
  mime: string
  bytes: Uint8Array
}): Promise<string> {
  const hash = await sha256Hex(params.bytes)
  const prepared = await POST_PREPARE({
    name: params.name,
    size: params.bytes.length,
    mime: params.mime,
    hash
  })

  // `chunks` 是服务端算出来的「还缺哪些分片」：秒传命中时为空，断点续传时只补缺的
  for (const index of prepared.chunks) {
    const start = index * CHUNK_SIZE
    const slice = params.bytes.subarray(start, Math.min(start + CHUNK_SIZE, params.bytes.length))
    await POST_CHUNK({ id: prepared.id, index, hash: await sha256Hex(slice), bytes: slice })
  }

  const finalized = await POST_FINALIZE(prepared.id)
  return finalized.id
}

export { CHUNK_SIZE, sha256Hex, uploadAsset }
export type { FinalizeResult, PrepareResult }
