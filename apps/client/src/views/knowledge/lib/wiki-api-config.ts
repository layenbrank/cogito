/**
 * 本机 Wiki HTTP / Clip 面配置（端口固定 19828）。
 */
import { invoke } from '@tauri-apps/api/core'

const STORAGE_KEY = 'knowledge.wiki-api.config'

interface WikiApiConfig {
  /** Wiki REST /api/v1 是否对外宣称启用（进程内鉴权开关） */
  enabled: boolean
  allowUnauthenticated: boolean
  allowLanAccess: boolean
  mcpEnabled: boolean
  /**
   * agent 代理（浏览器扩展用）：默认关闭。
   *
   * 它把 agentd 的会话面挂到 `/api/v1/agent/*`，能写文件、能跑命令 —— 所以既不蹭
   * 「本机免鉴权」，也不允许局域网可达。开启前必须先配一个 Token。
   */
  agentEnabled: boolean
  token: string
  port: number
}

const WIKI_API_DEFAULTS: WikiApiConfig = {
  enabled: true,
  allowUnauthenticated: true,
  allowLanAccess: false,
  mcpEnabled: true,
  agentEnabled: false,
  token: '',
  port: 19828
}

const WIKI_API_ENDPOINTS = [
  { method: 'GET', path: '/health', note: 'Clip 守护心跳' },
  { method: 'POST', path: '/clip', note: '剪藏入库' },
  { method: 'GET', path: '/api/v1/health', note: 'Wiki API 健康检查' },
  { method: 'GET', path: '/api/v1/bases', note: '知识库列表' },
  { method: 'GET', path: '/api/v1/search', note: '全文检索 ?q=' },
  { method: 'POST', path: '/api/v1/search', note: '全文检索 JSON body' },
  { method: 'GET', path: '/api/v1/agent/status', note: '扩展探活（免令牌）' },
  { method: 'ALL', path: '/api/v1/agent/*', note: '扩展代理到 agentd（必须令牌）' }
] as const

function readWikiApiConfig(): WikiApiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...WIKI_API_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<WikiApiConfig>
    return { ...WIKI_API_DEFAULTS, ...parsed, port: Number(parsed.port) || 19828 }
  } catch (error) {
    console.warn('[wiki-api-config] read failed', error)
    return { ...WIKI_API_DEFAULTS }
  }
}

function writeWikiApiConfig(config: WikiApiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[wiki-api-config] write failed', error)
  }
}

async function syncWikiHttpRuntime(config: WikiApiConfig): Promise<void> {
  try {
    await invoke('wiki_http_configure', {
      patch: {
        enabled: config.enabled,
        allowUnauthenticated: config.allowUnauthenticated,
        allowLanAccess: config.allowLanAccess,
        mcpEnabled: config.mcpEnabled,
        agentEnabled: config.agentEnabled,
        token: config.token
      }
    })
  } catch (error) {
    console.warn('[wiki-api-config] sync runtime failed', error)
  }
}

function patchWikiApiConfig(patch: Partial<WikiApiConfig>): WikiApiConfig {
  const next = { ...readWikiApiConfig(), ...patch }
  writeWikiApiConfig(next)
  void syncWikiHttpRuntime(next)
  return next
}

/**
 * 启动时把已保存的配置灌回 Rust。
 *
 * Rust 侧（`bridge::clip` 的 `config_handles()`）只是**进程内**状态：不推一次，重启后
 * 就回到默认值（`agentEnabled=false` / `token=""`），设置页却还显示开着 —— 表现为
 * 「昨天还能用，今天扩展连不上了」。
 */
function bootstrapWikiApiConfig(): void {
  void syncWikiHttpRuntime(readWikiApiConfig())
}

export {
  WIKI_API_DEFAULTS,
  WIKI_API_ENDPOINTS,
  bootstrapWikiApiConfig,
  patchWikiApiConfig,
  readWikiApiConfig,
  syncWikiHttpRuntime,
  writeWikiApiConfig
}
export type { WikiApiConfig }
