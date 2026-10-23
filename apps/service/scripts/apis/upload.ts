import { Buffer } from 'node:buffer'
import { http } from '../utils/http.ts'
import { HttpResponse } from '../utils/http.errors.ts'

const API_BASE_URL = 'api/v1/upload'
const PAGE_SIZE = 20

function POST_PREPARE(data: Upload.Prepare.Params) {
  return HttpResponse<Upload.Prepare.Response>(http.post(`${API_BASE_URL}/prepare`, { json: data }))
}

function PATCH_HASH(data: Upload.Hash.Params) {
  return HttpResponse<Upload.Hash.Response>(http.patch(`${API_BASE_URL}/hash`, { json: data }))
}

function POST_CHUNK(data: Upload.Chunk.Params) {
  const form = new FormData()
  form.append('id', data.id)
  form.append('index', String(data.index))
  form.append('hash', data.hash)
  if (data.data && data.data.length > 0) {
    // Buffer.buffer 为 ArrayBufferLike，与 DOM BlobPart 不兼容；复制为 Uint8Array
    const chunk = Uint8Array.from(data.data)
    form.append(
      'chunk',
      new Blob([chunk], { type: 'application/octet-stream' }),
      `chunk-${data.index}.part`
    )
  }
  return HttpResponse<Upload.Chunk.Response>(http.post(`${API_BASE_URL}/chunk`, { body: form }))
}

function POST_FINALIZE(data: Upload.Finalize.Params, options?: { timeout?: number }) {
  return HttpResponse<Upload.Finalize.Response>(
    http.post(`${API_BASE_URL}/finalize`, {
      json: data,
      timeout: options?.timeout
    })
  )
}

function GET_PROGRESS(id: string) {
  return HttpResponse<Upload.Progress.Response>(http.get(`${API_BASE_URL}/progress/${id}`))
}

function GET_FILES(page = 1, size = PAGE_SIZE) {
  return HttpResponse<Upload.Files.Response>(
    http.get(`${API_BASE_URL}/files`, { searchParams: { page, size } })
  )
}

async function GET_ASSET(pathOrUrl: string): Promise<Buffer> {
  const path = pathOrUrl.startsWith('http') ? new URL(pathOrUrl).pathname : pathOrUrl
  const relative = path.replace(/^\//, '')
  const buf = await http.get(relative).arrayBuffer()
  return Buffer.from(buf)
}

export { GET_ASSET, GET_FILES, GET_PROGRESS, PATCH_HASH, POST_CHUNK, POST_FINALIZE, POST_PREPARE }
