import { API_PATHS, API_SUCCESS_CODE } from '@/constants/api'
import { findApiBaseUrl } from '@/constants/config'
import type { RSF } from '@/types/response'

class ApiError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: unknown
  token?: string | null
  tenantId?: string | null
  signal?: AbortSignal
}

/**
 * Builds absolute URL against rust-service base.
 */
function buildUrl(path: string) {
  const base = findApiBaseUrl()
  if (!base) {
    throw new ApiError(0, 'API base URL is not configured')
  }
  return `${base}${path}`
}

/**
 * Returns true when envelope indicates business success (`200000`).
 */
function isApiSuccess(code: number) {
  return code === API_SUCCESS_CODE
}

/**
 * Parses rust-service JSON envelope from a fetch Response.
 */
async function parseEnvelope<T>(response: Response): Promise<RSF<T>> {
  const payload = (await response.json()) as Partial<RSF<T>> & { message?: string }

  if (typeof payload.code === 'number') {
    return {
      code: payload.code,
      success: payload.success ?? isApiSuccess(payload.code),
      msg: payload.msg ?? payload.message ?? '',
      data: (payload.data as T) ?? (null as T),
      timestamp: payload.timestamp ?? Date.now()
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload.msg ?? payload.message ?? response.statusText)
  }

  return {
    code: API_SUCCESS_CODE,
    success: true,
    msg: 'ok',
    data: payload as T,
    timestamp: Date.now()
  }
}

/**
 * Performs JSON request against rust-service and returns the business envelope.
 */
async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<RSF<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }
  if (options.tenantId) {
    headers['X-Tenant-ID'] = options.tenantId
  }

  const response = await fetch(buildUrl(path), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
  })

  return parseEnvelope<T>(response)
}

/**
 * Throws ApiError when envelope is not successful.
 */
function assertApiSuccess<T>(result: RSF<T>): T {
  if (!isApiSuccess(result.code)) {
    throw new ApiError(result.code, result.msg || 'Request failed')
  }
  return result.data
}

export { ApiError, assertApiSuccess, buildUrl, isApiSuccess, parseEnvelope, requestJson }
