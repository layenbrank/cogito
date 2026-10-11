import { FetchError } from 'ofetch'

import { TRACEPARENT_HEADER, traceIdOf } from './trace.ts'

/** 与 cogito / studio 信封一致：业务成功码 200000 */
export const SUCCESS_CODE = 200000

export class HttpException extends Error {
  readonly code: number
  readonly status?: number
  readonly data?: unknown
  /** 服务端回显的 trace-id，用于把前端报错和服务端链路日志对上 */
  readonly traceId?: string

  constructor(
    message: string,
    code: number,
    options: { status?: number; data?: unknown; traceId?: string } = {}
  ) {
    super(message)
    this.name = 'HttpException'
    this.code = code
    this.status = options.status
    this.data = options.data
    this.traceId = options.traceId
  }
}

/** 解析 { code, msg, data } 信封响应，非成功码抛 HttpException */
export function HttpEnvelope<T>(envelope: RSF<T>): T {
  if (envelope.code !== SUCCESS_CODE) {
    throw new HttpException(envelope.msg || '业务请求失败', envelope.code, {
      data: envelope.data,
      traceId: envelope.traceID
    })
  }
  return envelope.data
}

/** 归一化 ofetch 抛出的错误为 HttpException */
export function HttpError(error: unknown): HttpException {
  if (error instanceof HttpException) return error

  if (error instanceof FetchError) {
    const status = error.response?.status ?? 0
    const data = error.data as RSF<unknown> | undefined
    // 信封里带 traceID；非信封响应（网关 502、5xx 文本等）退回读响应头的 traceparent
    const traceId = data?.traceID ?? traceIdOf(error.response?.headers.get(TRACEPARENT_HEADER))
    if (data && typeof data.code === 'number' && data.code !== SUCCESS_CODE) {
      return new HttpException(data.msg || '业务请求失败', data.code, {
        status,
        data: data.data,
        traceId
      })
    }
    return new HttpException(error.message || '网络请求失败', -1, { status, traceId })
  }

  return new HttpException(error instanceof Error ? error.message : '网络请求失败', -1)
}
