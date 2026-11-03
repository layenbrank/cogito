/**
 * Windows AnyTXT 本地全文检索配置。
 */
const STORAGE_KEY = 'knowledge.anytxt.config'

interface AnyTxtConfig {
  enabled: boolean
  endpoint: string
  filterDir: string
  filterExt: string
  limit: number
}

const ANYTXT_DEFAULTS: AnyTxtConfig = {
  enabled: false,
  endpoint: 'http://127.0.0.1:9920',
  filterDir: '',
  filterExt: '*',
  limit: 20
}

function readAnyTxtConfig(): AnyTxtConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...ANYTXT_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<AnyTxtConfig>
    return {
      ...ANYTXT_DEFAULTS,
      ...parsed,
      enabled: Boolean(parsed.enabled),
      limit: Math.max(1, Math.min(100, Number(parsed.limit) || ANYTXT_DEFAULTS.limit))
    }
  } catch (error) {
    console.warn('[anytxt-config] read failed', error)
    return { ...ANYTXT_DEFAULTS }
  }
}

function writeAnyTxtConfig(config: AnyTxtConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[anytxt-config] write failed', error)
  }
}

function patchAnyTxtConfig(patch: Partial<AnyTxtConfig>): AnyTxtConfig {
  const next = { ...readAnyTxtConfig(), ...patch }
  writeAnyTxtConfig(next)
  return next
}

export { ANYTXT_DEFAULTS, patchAnyTxtConfig, readAnyTxtConfig, writeAnyTxtConfig }
export type { AnyTxtConfig }
