/**
 * 定时扫描导入目录（对齐 llm_wiki Scheduled Import）。
 */
const STORAGE_KEY = 'knowledge.scheduled-import.config'

interface ScheduledImportConfig {
  enabled: boolean
  path: string
  /** 分钟 */
  intervalMinutes: number
}

const SCHEDULED_IMPORT_DEFAULTS: ScheduledImportConfig = {
  enabled: false,
  path: '',
  intervalMinutes: 60
}

function readScheduledImportConfig(): ScheduledImportConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...SCHEDULED_IMPORT_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<ScheduledImportConfig>
    return {
      ...SCHEDULED_IMPORT_DEFAULTS,
      ...parsed,
      enabled: Boolean(parsed.enabled),
      intervalMinutes: Math.max(
        5,
        Number(parsed.intervalMinutes) || SCHEDULED_IMPORT_DEFAULTS.intervalMinutes
      )
    }
  } catch (error) {
    console.warn('[scheduled-import-config] read failed', error)
    return { ...SCHEDULED_IMPORT_DEFAULTS }
  }
}

function writeScheduledImportConfig(config: ScheduledImportConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[scheduled-import-config] write failed', error)
  }
}

function patchScheduledImportConfig(
  patch: Partial<ScheduledImportConfig>
): ScheduledImportConfig {
  const next = { ...readScheduledImportConfig(), ...patch }
  writeScheduledImportConfig(next)
  return next
}

export {
  SCHEDULED_IMPORT_DEFAULTS,
  patchScheduledImportConfig,
  readScheduledImportConfig,
  writeScheduledImportConfig
}
export type { ScheduledImportConfig }
