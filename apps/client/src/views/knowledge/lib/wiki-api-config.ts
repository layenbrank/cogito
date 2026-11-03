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
  token: string
  port: number
}

const WIKI_API_DEFAULTS: WikiApiConfig = {
  enabled: true,
  allowUnauthenticated: true,
  allowLanAccess: false,
  mcpEnabled: true,
  token: '',
  port: 19828
}

const WIKI_API_ENDPOINTS = [
  { method: 'GET', path: '/health', note: 'Clip 守护心跳' },
  { method: 'POST', path: '/clip', note: '剪藏入库' },
  { method: 'GET', path: '/api/v1/health', note: 'Wiki API 健康检查' },
  { method: 'GET', path: '/api/v1/bases', note: '知识库列表' },
  { method: 'GET', path: '/api/v1/search', note: '全文检索 ?q=' },
  { method: 'POST', path: '/api/v1/search', note: '全文检索 JSON body' }
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

export {
  WIKI_API_DEFAULTS,
  WIKI_API_ENDPOINTS,
  patchWikiApiConfig,
  readWikiApiConfig,
  syncWikiHttpRuntime,
  writeWikiApiConfig
}
export type { WikiApiConfig }
