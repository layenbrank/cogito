import { ofetch, type FetchOptions } from 'ofetch'

import { TIMEOUT_MS } from './http.errors'
import { findAuthToken } from './auth'
import { findActiveTenantID } from './tenant'
import { createTraceparent, TRACEPARENT_HEADER } from './trace'

type HttpOptions = Omit<FetchOptions<'json'>, 'method' | 'body'>
type HttpBody = FetchOptions['body']

const fetcher = ofetch.create({
  baseURL: import.meta.env.VITE_COGITO,
  timeout: TIMEOUT_MS,
  onRequest({ request, options }) {
    const url = findRequestUrl(request)
    // 自家接口带上链路：服务端据此把入口日志、下游调用与响应回显串成同一条链路
    if (isCogitoUrl(url) && !options.headers.has(TRACEPARENT_HEADER)) {
      options.headers.set(TRACEPARENT_HEADER, createTraceparent())
    }

    const tenantID = isGatewayUrl(url) ? findActiveTenantID() : null
    if (tenantID) options.headers.set('X-Tenant-ID', tenantID)

    const token = findAuthToken()
    if (!token || !isCogitoUrl(url)) return
    options.headers.set('Authorization', `Bearer ${token}`)
  }
})

function findRequestUrl(request: RequestInfo) {
  if (typeof request === 'string') return request
  if (request instanceof URL) return request.toString()
  return request.url
}

/** 相对路径走自家接口；绝对地址只有落在 VITE_COGITO 上才带登录令牌。 */
function isCogitoUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return true
  const base = import.meta.env.VITE_COGITO
  if (!base) return false
  return url.startsWith(base)
}

/**
 * 网关接口（`/gateway/*`）：模型目录、转发、配额、档位。
 *
 * 这些接口认 `X-Tenant-ID`，服务端据此决定「能看见哪些模型」与「配额记在谁头上」；不带这个头
 * 就按账号归属兜底，团队共享的模型会整批不可见 —— 目录为空就是这么来的。客户端一律用相对路径
 * 调网关（`baseURL` 已含 `/api/v1`），绝对地址这里只按路径片段判断。
 */
function isGatewayUrl(url: string): boolean {
  if (!isCogitoUrl(url)) return false
  return url.includes('/gateway/')
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
