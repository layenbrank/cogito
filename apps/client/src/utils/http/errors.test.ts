import { FetchError, type FetchResponse } from 'ofetch'
import { describe, expect, it } from 'vitest'

import { HttpEnvelope, HttpError, HttpException, SUCCESS_CODE } from '@/utils/http/errors.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`

function envelope<T>(patch: Partial<RSF<T>> = {}): RSF<T> {
  return {
    code: SUCCESS_CODE,
    success: true,
    msg: '',
    data: null as T,
    timestamp: 1_700_000_000_000,
    ...patch
  }
}

function fetchError(options: {
  status?: number
  headers?: Record<string, string>
  data?: unknown
}): FetchError {
  const error = new FetchError('请求失败', { cause: new Error('boom') })
  error.response = {
    status: options.status ?? 500,
    headers: new Headers(options.headers)
  } as unknown as FetchResponse<unknown>
  error.data = options.data
  return error
}

describe('HttpEnvelope', function () {
  it('returns the payload on success', function () {
    expect(HttpEnvelope(envelope({ data: { id: 'a' } }))).toEqual({ id: 'a' })
  })

  it('carries the server trace-id into the exception', function () {
    const thrown = (() => {
      try {
        HttpEnvelope(envelope({ code: 401, success: false, msg: '登录已过期', traceID: TRACE_ID }))
        // eslint-disable-next-line ith/catch-must-report -- 测试就是要取出抛出的异常来断言，不存在漏报
      } catch (error) {
        return error as HttpException
      }
      return null
    })()

    expect(thrown?.traceId).toBe(TRACE_ID)
    expect(thrown?.message).toBe('登录已过期')
  })

  it('leaves traceId undefined when the server sent no trace-id', function () {
    const thrown = (() => {
      try {
        HttpEnvelope(envelope({ code: 401, success: false }))
        // eslint-disable-next-line ith/catch-must-report -- 同上：刻意取异常断言
      } catch (error) {
        return error as HttpException
      }
      return null
    })()

    expect(thrown?.traceId).toBeUndefined()
  })
})

describe('HttpError', function () {
  it('passes an existing HttpException through untouched', function () {
    const original = new HttpException('已处理', 1)
    expect(HttpError(original)).toBe(original)
  })

  it('prefers the envelope traceID on a business error', function () {
    const exception = HttpError(
      fetchError({
        status: 200,
        headers: { traceparent: TRACEPARENT },
        data: envelope({ code: 401, success: false, msg: '登录已过期', traceID: TRACE_ID })
      })
    )

    expect(exception.code).toBe(401)
    expect(exception.message).toBe('登录已过期')
    expect(exception.traceId).toBe(TRACE_ID)
  })

  it('falls back to the echoed traceparent header for non-envelope failures', function () {
    const exception = HttpError(
      fetchError({
        status: 502,
        headers: { traceparent: TRACEPARENT },
        data: '<html>bad gateway</html>'
      })
    )

    expect(exception.code).toBe(-1)
    expect(exception.status).toBe(502)
    expect(exception.traceId).toBe(TRACE_ID)
  })

  it('ignores a missing or malformed response traceparent', function () {
    expect(HttpError(fetchError({ status: 500 })).traceId).toBeUndefined()
    expect(
      HttpError(fetchError({ status: 500, headers: { traceparent: 'nope' } })).traceId
    ).toBeUndefined()
  })

  it('normalizes non-fetch errors', function () {
    const exception = HttpError(new TypeError('failed to fetch'))

    expect(exception.code).toBe(-1)
    expect(exception.message).toBe('failed to fetch')
    expect(exception.traceId).toBeUndefined()
  })
})
