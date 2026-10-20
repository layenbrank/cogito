import { ofetch, type FetchOptions } from 'ofetch'

import { findAuthToken } from '@/utils/auth'
import { findActiveTenantID } from '@/utils/tenant.ts'
import { ENV_URLS } from './env.ts'
import { createTraceparent, TRACEPARENT_HEADER } from './trace.ts'

declare module 'ofetch' {
  interface FetchOptions {
    env?: EnvURL
  }
}

type HttpOptions = Omit<FetchOptions<'json'>, 'method' | 'body'>
type HttpBody = FetchOptions['body']

const fetcher = ofetch.create({
  onRequest({ request, options }) {
    const url = findRequestUrl(request)
    if (isOwnUrl(url) && !options.headers.has(TRACEPARENT_HEADER)) {
      options.headers.set(TRACEPARENT_HEADER, createTraceparent())
    }

    if (options.env) {
      options.baseURL = ENV_URLS[options.env]
      delete options.env
    }

    const own = isOwnUrl(url) || Boolean(options.baseURL)
    if (own) {
      const token = findAuthToken()
      if (token) options.headers.set('Authorization', `Bearer ${token}`)

      const tenantID = findActiveTenantID()
      if (tenantID) options.headers.set('X-Tenant-ID', tenantID)
    }
  }
})

function isOwnUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return true
  return Object.values(ENV_URLS).some(function (base) {
    return base && url.startsWith(base)
  })
}

function findRequestUrl(request: RequestInfo | URL) {
  if (typeof request === 'string') return request
  if (request instanceof URL) return request.toString()
  return request.url
}

export const http = {
  get<T>(url: string, options?: HttpOptions) {
    return fetcher<T>(url, { ...options, method: 'GET' })
  },
  post<T>(url: string, body?: HttpBody, options?: HttpOptions) {
    return fetcher<T>(url, { ...options, method: 'POST', body })
  },
  put<T>(url: string, body?: HttpBody, options?: HttpOptions) {
    return fetcher<T>(url, { ...options, method: 'PUT', body })
  },
  patch<T>(url: string, body?: HttpBody, options?: HttpOptions) {
    return fetcher<T>(url, { ...options, method: 'PATCH', body })
  },
  delete<T>(url: string, options?: HttpOptions) {
    return fetcher<T>(url, { ...options, method: 'DELETE' })
  }
}
