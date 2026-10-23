import { type ResponsePromise, HTTPError } from 'ky'

/** 与 `src/utils/code.rs` SUCCESS 对齐 */
export const SUCCESS_CODE: number = 200_000
export const TIMEOUT_MS: number = 30_000

export class HttpException extends Error {
  readonly code: number
  readonly status?: number
  readonly data?: unknown

  constructor(
    message: string,
    code: number,
    options: {
      status?: number
      data?: unknown
    } = {}
  ) {
    super(message)
    this.name = 'HttpException'
    this.code = code
    this.status = options.status
    this.data = options.data
  }
}

/**
 * 解析 `{ code, data, msg, success }` 信封响应。
 * 业务 API 用法：`HttpResponse(http.get('api/v1/...'))`
 */
export async function HttpResponse<T>(request: ResponsePromise): Promise<T> {
  try {
    const envelope = await request.json<Envelope<T>>()
    return HttpEnvelope(envelope)
  } catch (error) {
    throw await HttpError(error)
  }
}

export function HttpEnvelope<T>(envelope: Envelope<T>): T {
  if (envelope.code !== SUCCESS_CODE) {
    throw new HttpException(envelope.msg || '业务请求失败', envelope.code, {
      data: envelope.data
    })
  }
  return envelope.data
}

export async function HttpError(error: unknown): Promise<HttpException> {
  if (error instanceof HttpException) {
    return error
  }

  if (error instanceof HTTPError) {
    const status = error.response.status
    let body: Envelope<unknown> | undefined

    try {
      const clone = error.response.clone()
      body = (await clone.json()) as Envelope<unknown>
    } catch {
      body = undefined
    }

    if (body && typeof body.code === 'number') {
      return new HttpException(body.msg || error.message, body.code, {
        status,
        data: body.data
      })
    }

    return new HttpException(error.message || `HTTP ${status}`, status, { status })
  }

  if (error instanceof Error) {
    return new HttpException(error.message, -1)
  }

  return new HttpException('未知网络错误', -1)
}
