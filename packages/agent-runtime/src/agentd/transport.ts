/**
 * agentd 的 HTTP 传输层：endpoint 解析 + Bearer + JSON 调用。
 *
 * ## 为什么 `findEndpoint` 是注入点
 *
 * agentd 是随桌面端分发的本地 sidecar，端口随机、令牌每次启动都换。宿主怎么问到这个
 * 地址，两条路完全不同：
 * - `apps/client`：Tauri 命令 `agentd:endpoint`（同进程，直接读状态）；
 * - `apps/extension`：本机 client 的桥（`GET /api/v1/agent/status`，令牌由客户端代持）。
 *
 * 但**协议本身一模一样**。把「去哪儿问地址」抽成注入点，剩下的请求构造、Bearer、
 * 401 失效语义就只有一份实现 —— 这是两端共用一条路径的关键接缝。
 */

interface AgentdEndpoint {
  baseUrl: string
  port: number
  pid: number
  version: string
  token: string
}

interface AgentdTransportOptions {
  /** 地址来源：由宿主实现（Tauri 命令 / 本机桥） */
  findEndpoint: () => Promise<AgentdEndpoint>
  /** fetch 实现：默认用全局 `fetch`；扩展侧可换成带重试的包装 */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

interface AgentdTransport {
  /** 解析并缓存地址；已缓存时直接返回（宿主有时只要地址本身，不要请求） */
  findEndpoint: () => Promise<AgentdEndpoint>
  call: (path: string, init?: RequestInit) => Promise<Response>
  callJson: <T>(path: string, init?: RequestInit) => Promise<T>
  /** 走白名单透传调用一个 goose ACP 方法（方法名必须在 agentd 的表里） */
  invokeGoose: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
  /** 丢弃缓存：agentd 重启后端点会变，状态事件或 401 都该调它 */
  forget: () => void
  /** 当前缓存的地址（未解析过为 null） */
  findCachedEndpoint: () => AgentdEndpoint | null
}

function createAgentdTransport(options: AgentdTransportOptions): AgentdTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  let cached: AgentdEndpoint | null = null

  function forget(): void {
    cached = null
  }

  function findCachedEndpoint(): AgentdEndpoint | null {
    return cached
  }

  async function findEndpoint(): Promise<AgentdEndpoint> {
    if (cached) return cached
    const value = await options.findEndpoint()
    cached = value
    return value
  }

  /**
   * 调 agentd 的 HTTP 面。
   *
   * 401 说明 agentd 重启过（令牌变了）：清掉缓存让下次重取，并把错误抛给调用方 ——
   * 静默重试会把「已经换了进程」这件事藏起来，排查时很难受。
   */
  async function call(path: string, init?: RequestInit): Promise<Response> {
    const endpoint = await findEndpoint()
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${endpoint.token}`)
    if (init?.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    const response = await fetchImpl(`${endpoint.baseUrl}${path}`, { ...init, headers })
    if (response.status === 401) {
      forget()
      throw new Error('agentd 拒绝了这个令牌（可能刚重启过），请重试')
    }
    return response
  }

  async function callJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await call(path, init)
    if (!response.ok) {
      const detail = await response.text().catch(function () {
        return ''
      })
      throw new Error(`agentd ${path} 返回 ${response.status}${detail ? `：${detail}` : ''}`)
    }
    return (await response.json()) as T
  }

  async function invokeGoose<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    return callJson<T>('/goose/invoke', {
      method: 'POST',
      body: JSON.stringify({ method, params })
    })
  }

  return { call, callJson, findCachedEndpoint, findEndpoint, forget, invokeGoose }
}

export { createAgentdTransport }
export type { AgentdEndpoint, AgentdTransport, AgentdTransportOptions }
