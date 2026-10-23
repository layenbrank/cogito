import {
  findCredentialKind,
  GATEWAY_PROVIDER_KIND,
  requiresApiKey
} from '@cogito/agent/provider'

/**
 * 把「provider 行 + 拿到的凭据」解析成一次请求的连接参数。
 *
 * 这是主进程唯一区分「平台网关」与「本机 BYOK」的地方，抽成纯函数是为了能单测：
 * 真正发请求的 `assistant.ts` 里全是 Electron / AI SDK 依赖，跑不进 unit 测试。
 *
 * 也是**唯一判定「这个 provider 到底能不能用」的地方**：解析结果是字符串就是不能用，调用方
 * （`engine.run` 直接报错、`config.ts` 跳过该行）都按它处理。云端 provider 没有 apiKey
 * 就不该放行 —— 放行只会让上游回一个用户看不懂的错，甚至让 opencode 端在解析时崩在内部字段上。
 */

/** 足以判定来源的 provider 形状（`chat.findProvider` 的返回值子集） */
interface ProviderLike {
  kind: string
  baseUrl: string | null
  /** 只用于错误文案；缺省时退回 kind */
  name?: string | null
}

/** 凭据来源：本机 BYOK 的 API Key，或平台网关的登录令牌 */
interface Credentials {
  apiKey: string | null
  platformToken: string | null
  /**
   * 当前租户 id：网关按 `X-Tenant-ID` 决定配额归属，也只有个人租户能命中订阅档位。
   * 拿不到就不带这个头 —— 服务端会按用户归属兜底（不会算错，只是订阅档位不生效）。
   */
  tenantID?: string | null
}

interface ProviderConnection {
  baseURL: string
  /** 没有凭据时省略（本机 Ollama / LM Studio 就不需要） */
  apiKey?: string
  /** 附加请求头：opencode 的 `provider.<id>.options.headers` 会原样透传给 provider 请求 */
  headers?: Record<string, string>
}

/**
 * 解析连接参数；缺 baseUrl 或缺平台令牌都返回错误文案而不是抛异常，
 * 让调用方决定怎么呈现（端口协议里只能回一个 `error` 事件）。
 */
function resolveConnection(
  provider: ProviderLike,
  credentials: Credentials
): ProviderConnection | string {
  const baseURL = provider.baseUrl
  if (!baseURL) return `provider 缺少 baseUrl: ${provider.kind}`

  if (findCredentialKind(provider.kind) === 'platform-token') {
    const platformToken = credentials.platformToken
    if (!platformToken) return '未登录或登录已过期，请重新登录后再用组织模型'

    const tenantID = credentials.tenantID
    return {
      baseURL,
      apiKey: platformToken,
      ...(tenantID ? { headers: { 'X-Tenant-ID': tenantID } } : {})
    }
  }

  const apiKey = credentials.apiKey
  // 云端 provider 没密钥就没法用：这里挡掉，用户看到的是「去配 Key」，而不是上游的 401
  if (!apiKey && requiresApiKey(provider.kind)) {
    return `${provider.name || provider.kind} 还没有配置 API Key，请在设置里补上`
  }
  return apiKey ? { baseURL, apiKey } : { baseURL }
}

/** provider 行是不是平台网关（渲染侧用固定 id，这里只认 kind） */
function isGatewayProvider(provider: ProviderLike): boolean {
  return provider.kind === GATEWAY_PROVIDER_KIND
}

export { findCredentialKind, isGatewayProvider, resolveConnection }
export type { Credentials, ProviderConnection, ProviderLike }
