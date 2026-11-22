/**
 * HTTP 唯一出口（扩展版）。
 *
 * 与 client `utils/http/http.ts` 对齐的是**语义**，不是实现：
 * - 只有落在自家 baseURL 上的请求才带 `Authorization` —— 绝对地址一旦跑到别处，
 *   绝不能把令牌带出去；
 * - 所有错误都归一成带 status 与响应片段的 `Error`，让界面能说清「哪一层坏了」。
 *
 * 与 client 不同的两点，都是环境决定的：
 * - **没有系统代理要绕**：浏览器自己管代理，`127.0.0.1` 由 Chrome 直接连；
 * - **走原生 `fetch`**：扩展页面在 `host_permissions` 覆盖的地址上不受 CORS 约束，
 *   不需要 Tauri 的 `plugin-http` 那一层。
 */

import { findAuthToken } from './secrets.ts'

/** 自家 API 的 baseURL（`.env` 的 `VITE_COGITO`，如 `https://api.example.com/api/v1`） */
function findOwnBaseURL(): string | null {
  const base: unknown = import.meta.env.VITE_COGITO
  if (typeof base !== 'string') return null
  const trimmed = base.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : null
}

function isOwnUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return true
  const base = findOwnBaseURL()
  return base !== null && url.startsWith(base)
}

function buildHeaders(url: string, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  if (isOwnUrl(url)) {
    const token = findAuthToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
  }
  return headers
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const target = /^https?:\/\//i.test(url) ? url : `${findOwnBaseURL() ?? ''}${url}`
  const response = await fetch(target, { ...init, headers: buildHeaders(target, init) })
  if (!response.ok) {
    const detail = await response.text().catch(function () {
      return ''
    })
    throw new Error(
      `${target} 返回 ${response.status}${detail ? `：${detail.slice(0, 300)}` : ''}`
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

const http = {
  /** HTTP GET */
  get<T>(url: string, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return requestJson<T>(url, { ...init, method: 'GET' })
  },
  /** HTTP POST；`body` 传对象时自动 JSON 序列化 */
  post<T>(url: string, body?: unknown, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
    return requestJson<T>(url, {
      ...init,
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  }
}

export { http, findOwnBaseURL, isOwnUrl, requestJson }
