import { FetchError } from 'ofetch'

import { TRACEPARENT_HEADER, traceIdOf } from './trace.ts'

export const SUCCESS_CODE = 200000

export class HttpException extends Error {
  readonly code: number
  readonly status?: number
  readonly data?: unknown
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

export function HttpEnvelope<T>(envelope: RSF<T>): T {
  if (envelope.code !== SUCCESS_CODE) {
    throw new HttpException(envelope.msg || '业务请求失败', envelope.code, {
      data: envelope.data,
      traceId: envelope.traceID
    })
  }
  return envelope.data
}

export function HttpError(error: unknown): HttpException {
  if (error instanceof HttpException) return error

  if (error instanceof FetchError) {
    const status = error.response?.status ?? 0
    const data = error.data as RSF<unknown> | undefined
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
