/**
 * R2 distribution Worker: versioned artifacts for users and dev environments.
 * GET/HEAD: public stream of versioned setup.exe（条件头：304 / 412；带 Range：206）
 * PUT/DELETE/multipart: require X-Custom-Auth-Key === AUTH_KEY_SECRET
 * Multipart actions: mpu-create / mpu-uploadpart / mpu-complete / mpu-abort.
 * Large uploads use multipart (not a single PUT): 5 MiB minimum part size, last part excepted.
 * 条件与范围的判定在 conditional.ts（纯函数，有单测）。
 */

import { findServedRange, isNotModified, isRangeStillValid } from './conditional.ts'
import { isSetupKey } from './setup-key.ts'

type MultipartCompleteBody = {
  parts: R2UploadedPart[]
}

/** 处理函数拿到的东西：请求 + 绑定 + 已经解析好的对象键与查询串 */
type RouteContext = {
  request: Request
  env: Env
  url: URL
  key: string
}

type RouteHandler = (context: RouteContext) => Promise<Response>

/**
 * 一条路由 = 处理函数 + 鉴权档。鉴权写在路由上，加路由就不会漏掉它
 * （以前是另一个 switch 里再列一遍方法，两处都得改）。
 */
type Route = {
  /** `public`：按读侧白名单放行；`secret`：要 X-Custom-Auth-Key */
  auth: 'public' | 'secret'
  handler: RouteHandler
}

function hasValidHeader(request: Request, env: Env): boolean {
  const secret = env.AUTH_KEY_SECRET
  if (!secret) {
    return false
  }
  return request.headers.get('X-Custom-Auth-Key') === secret
}

function parseObjectKey(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\/+/, ''))
}

function notFound(): Response {
  return new Response('Object Not Found', { status: 404 })
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 })
}

/** 线上只有 wrangler tail 能看到原因，所以失败都落一条日志，再把原因回给客户端 */
function reportError(scope: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[distribution] ${scope}: ${message}`)
  return message
}

/** 下载与元数据共用的头部：R2 的 httpMetadata + etag + 强制 octet-stream + 一年缓存 */
function findDownloadHeaders(object: R2Object, key: string): Headers {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('Content-Type', 'application/octet-stream')
  headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return headers
}

/** 整写：`onlyIf` 把客户端的 If-Match / If-None-Match 当条件写（官方参考实现也传它）； */
async function putObject({ request, env, key }: RouteContext): Promise<Response> {
  // 条件不满足时 R2 不报错，只回 null —— 不接住就会把失败写成「成功」
  const object = await env.DOWNLOADS.put(key, request.body, {
    onlyIf: request.headers,
    httpMetadata: request.headers
  })
  if (object === null) {
    return new Response('Precondition Failed', { status: 412 })
  }
  return new Response(`Put ${key} successfully!`)
}

/** 公开读：`?meta=1` 只回元数据（Store 校验体积用），否则流式下载 */
async function readObject({ request, env, url, key }: RouteContext): Promise<Response> {
  if (url.searchParams.get('meta') === '1') {
    const head = await env.DOWNLOADS.head(key)
    if (head === null) {
      return notFound()
    }
    return Response.json({
      key: head.key,
      size: head.size,
      etag: head.httpEtag,
      uploaded: head.uploaded ? new Date(head.uploaded).toISOString() : null
    })
  }

  // `If-Range` 不在 R2 认的条件头里，先拿元数据自己判：不成立就不把 Range 交给 R2（回整份 200）
  const ifRange = request.headers.get('If-Range')
  const canServeRange =
    request.headers.has('Range') &&
    (ifRange === null || isRangeStillValid(ifRange, await env.DOWNLOADS.head(key)))

  const object = await env.DOWNLOADS.get(key, {
    range: canServeRange ? request.headers : undefined,
    onlyIf: request.headers
  })

  if (object === null) {
    return notFound()
  }

  const headers = findDownloadHeaders(object, key)

  // 条件读未满足：R2 只回一个不带 body 的对象。「没变」按 RFC 7232 回 304，其余（If-Match 不匹配）才是 412
  if (!('body' in object)) {
    return new Response(null, {
      status: isNotModified(request, object) ? 304 : 412,
      headers
    })
  }

  // 带 Range 的请求按 HTTP 语义回 206 + Content-Range + 分片长度
  // （官方示例固定回 200，客户端会把「局部字节」当成完整 body）。没带 Range 仍是 200。
  const served = findServedRange(object, canServeRange)
  if (served) {
    headers.set(
      'Content-Range',
      `bytes ${served.offset}-${served.offset + served.length - 1}/${object.size}`
    )
    headers.set('Content-Length', String(served.length))
    return new Response(object.body, { status: 206, headers })
  }

  headers.set('Content-Length', String(object.size))
  return new Response(object.body, { status: 200, headers })
}

/** HEAD：与 GET 同样的头部，没有 body（Store 用它校验体积） */
async function statObject({ request, env, key }: RouteContext): Promise<Response> {
  const head = await env.DOWNLOADS.head(key)
  if (head === null) {
    return notFound()
  }
  const headers = findDownloadHeaders(head, key)
  // head() 不吃 onlyIf，缓存再验证（If-None-Match / If-Modified-Since）自己判
  if (isNotModified(request, head)) {
    return new Response(null, { status: 304, headers })
  }
  headers.set('Content-Length', String(head.size))
  return new Response(null, { status: 200, headers })
}

async function deleteObject({ env, key }: RouteContext): Promise<Response> {
  await env.DOWNLOADS.delete(key)
  return new Response('Deleted!')
}

async function createMultipart({ env, key }: RouteContext): Promise<Response> {
  const multipart = await env.DOWNLOADS.createMultipartUpload(key, {
    httpMetadata: { contentType: 'application/octet-stream' }
  })
  return Response.json({
    key: multipart.key,
    uploadId: multipart.uploadId
  })
}

async function uploadPart({ request, env, url, key }: RouteContext): Promise<Response> {
  const uploadId = url.searchParams.get('uploadId')
  const partNumber = Number(url.searchParams.get('partNumber'))
  if (!uploadId || !partNumber) {
    return badRequest('Missing uploadId or partNumber')
  }
  if (!request.body) {
    return badRequest('Missing body')
  }
  const multipart = env.DOWNLOADS.resumeMultipartUpload(key, uploadId)
  let part: R2UploadedPart
  try {
    part = await multipart.uploadPart(partNumber, request.body)
  } catch (error) {
    // uploadId 不存在 / 已 abort 这类都是客户端问题：回 400 而不是让它冒成 500
    return badRequest(reportError('mpu-uploadpart', error))
  }
  return Response.json(part)
}

async function completeMultipart({ request, env, url, key }: RouteContext): Promise<Response> {
  const uploadId = url.searchParams.get('uploadId')
  if (!uploadId) {
    return badRequest('Missing uploadId')
  }
  const body = (await request.json()) as MultipartCompleteBody
  const multipart = env.DOWNLOADS.resumeMultipartUpload(key, uploadId)
  let object: R2Object
  try {
    object = await multipart.complete(body.parts)
  } catch (error) {
    return badRequest(reportError('mpu-complete', error))
  }
  return Response.json({
    key: object.key,
    size: object.size,
    etag: object.httpEtag
  })
}

async function abortMultipart({ env, url, key }: RouteContext): Promise<Response> {
  const uploadId = url.searchParams.get('uploadId')
  if (!uploadId) {
    return badRequest('Missing uploadId')
  }
  const multipart = env.DOWNLOADS.resumeMultipartUpload(key, uploadId)
  try {
    await multipart.abort()
  } catch (error) {
    return badRequest(reportError('mpu-abort', error))
  }
  return new Response(null, { status: 204 })
}

/** 路由表：键 = 方法（或「方法 + action」），值 = 处理函数 + 鉴权档 */
const ROUTES: Record<string, Route> = {
  GET: { auth: 'public', handler: readObject },
  HEAD: { auth: 'public', handler: statObject },
  PUT: { auth: 'secret', handler: putObject },
  DELETE: { auth: 'secret', handler: deleteObject },
  'POST mpu-create': { auth: 'secret', handler: createMultipart },
  'PUT mpu-uploadpart': { auth: 'secret', handler: uploadPart },
  'POST mpu-complete': { auth: 'secret', handler: completeMultipart },
  'DELETE mpu-abort': { auth: 'secret', handler: abortMultipart }
}

const ALLOW_METHODS = 'GET, HEAD, PUT, DELETE, POST'

function findRoute(method: string, action: string | null): Route | undefined {
  return action ? ROUTES[`${method} ${action}`] : ROUTES[method]
}

async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const key = parseObjectKey(url)
  const action = url.searchParams.get('action')

  if (!key) {
    return badRequest('Missing object key')
  }

  const route = findRoute(request.method, action)
  if (!route) {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: ALLOW_METHODS }
    })
  }

  const allowed = route.auth === 'secret' ? hasValidHeader(request, env) : isSetupKey(key)
  if (!allowed) {
    return new Response('Forbidden', { status: 403 })
  }

  return route.handler({ request, env, url, key })
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleFetch(request, env)
    } catch (error) {
      return new Response(`Worker error: ${reportError('fetch', error)}`, { status: 500 })
    }
  }
}

export { worker as default }
