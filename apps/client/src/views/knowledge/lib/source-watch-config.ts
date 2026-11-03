/**
 * raw/sources 自动监听配置（对齐 llm_wiki Source Watch schema / 默认值）。
 */
const STORAGE_KEY = 'knowledge.source-watch.config'
const ALL_BASES_STORAGE_KEY = 'knowledge.source-watch.all-bases'

const MAX_USER_CONCURRENCY = 64
const MIN_USER_CONCURRENCY = 1

interface SourceWatchConfig {
  enabled: boolean
  /** 监听到变更时是否自动入 ingest 队列 */
  autoIngest: boolean
  /** 将解析正文落到 raw/parsed（与 sources 同结构） */
  persistExtractedMarkdown: boolean
  /** 文档解析并发（PDF 等抽取阶段） */
  parsingConcurrency: number
  /** 资料提取 / ingest 并发 */
  ingestConcurrency: number
  /** 允许的扩展名（无点，如 md） */
  includeExtensions: string[]
  excludeExtensions: string[]
  excludeDirs: string[]
  excludeGlobs: string[]
  maxFileSizeMb: number
  /** Tauri watch 防抖 */
  delayMs: number
}

interface SourceWatchFileTypeGroup {
  id: string
  label: string
  extensions: readonly string[]
}

const SOURCE_WATCH_FILE_TYPE_GROUPS: readonly SourceWatchFileTypeGroup[] = [
  {
    id: 'documents',
    label: '文档',
    extensions: [
      'md',
      'mdx',
      'txt',
      'org',
      'pdf',
      'doc',
      'docx',
      'docm',
      'odt',
      'rtf',
      'epub',
      'mobi'
    ]
  },
  {
    id: 'presentations',
    label: '演示文档',
    extensions: ['ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm', 'odp']
  },
  {
    id: 'spreadsheets',
    label: '表格',
    extensions: ['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv']
  },
  {
    id: 'web',
    label: '网页',
    extensions: ['html', 'htm']
  },
  {
    id: 'data',
    label: '数据',
    extensions: ['json', 'yaml', 'yml', 'xml']
  },
  {
    id: 'images',
    label: '图片',
    extensions: ['png', 'jpg', 'jpeg']
  }
]

const SOURCE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const

const SOURCE_WATCH_DEFAULTS: SourceWatchConfig = {
  enabled: true,
  autoIngest: true,
  persistExtractedMarkdown: false,
  parsingConcurrency: 2,
  ingestConcurrency: 1,
  includeExtensions: [
    'md',
    'mdx',
    'txt',
    'org',
    'pdf',
    'doc',
    'docx',
    'docm',
    'ppt',
    'pps',
    'pot',
    'pptx',
    'pptm',
    'ppsx',
    'ppsm',
    'xls',
    'xlsx',
    'xlsm',
    'xlsb',
    'odt',
    'odp',
    'ods',
    'rtf',
    'html',
    'htm',
    'csv',
    'png',
    'jpg',
    'jpeg'
  ],
  excludeExtensions: [
    'tmp',
    'temp',
    'bak',
    'swp',
    'part',
    'partial',
    'crdownload',
    'exe',
    'dll',
    'so',
    'dylib',
    'bin',
    'iso',
    'dmg'
  ],
  excludeDirs: [
    '.git',
    '.svn',
    '.hg',
    '.obsidian',
    '.idea',
    '.vscode',
    'node_modules',
    '.cache',
    '__pycache__',
    '.staging'
  ],
  excludeGlobs: ['~$*', '.~lock.*#', '*.draft.*', 'draft-*', '*.private.*'],
  maxFileSizeMb: 100,
  delayMs: 800
}

const LEGACY_DEFAULT_INCLUDE_EXTENSIONS = SOURCE_WATCH_DEFAULTS.includeExtensions.filter(
  function (extension) {
    return !(SOURCE_IMAGE_EXTENSIONS as readonly string[]).includes(extension)
  }
)

/** 旧版 cogito 文本框默认（读出后无点）→ 升级为完整文档类型默认 */
const LEGACY_COGITO_INCLUDE_EXTENSIONS = [
  'md',
  'markdown',
  'pdf',
  'txt',
  'png',
  'jpg',
  'jpeg'
]

function clampUserConcurrency(value: number, fallback: number): number {
  const resolved = Number.isFinite(value) ? Math.floor(value) : Math.floor(fallback)
  return Math.max(MIN_USER_CONCURRENCY, Math.min(MAX_USER_CONCURRENCY, resolved))
}

function normalizeExtensions(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .flatMap(function (value) {
          return value.split(/[,，\n]/)
        })
        .map(function (value) {
          return value.trim().replace(/^\./, '').toLowerCase()
        })
        .filter(Boolean)
    )
  ]
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .flatMap(function (value) {
          return value.split(/[,，\n]/)
        })
        .map(function (value) {
          return value.trim()
        })
        .filter(Boolean)
    )
  ]
}

function normalizeSourceWatchConfig(
  config?: Partial<SourceWatchConfig> | null
): SourceWatchConfig {
  const rawParsing =
    config?.parsingConcurrency ?? SOURCE_WATCH_DEFAULTS.parsingConcurrency
  const parsingConcurrency = Number.isFinite(rawParsing)
    ? clampUserConcurrency(rawParsing, SOURCE_WATCH_DEFAULTS.parsingConcurrency)
    : SOURCE_WATCH_DEFAULTS.parsingConcurrency
  const rawIngest = config?.ingestConcurrency ?? SOURCE_WATCH_DEFAULTS.ingestConcurrency
  const ingestConcurrency = Number.isFinite(rawIngest)
    ? clampUserConcurrency(rawIngest, SOURCE_WATCH_DEFAULTS.ingestConcurrency)
    : SOURCE_WATCH_DEFAULTS.ingestConcurrency

  const includeExtensions = normalizeExtensions(
    config?.includeExtensions ?? SOURCE_WATCH_DEFAULTS.includeExtensions
  )
  const usesLegacyNoImages =
    includeExtensions.length === LEGACY_DEFAULT_INCLUDE_EXTENSIONS.length &&
    LEGACY_DEFAULT_INCLUDE_EXTENSIONS.every(function (extension) {
      return includeExtensions.includes(extension)
    })
  const usesLegacyCogitoShort =
    includeExtensions.length === LEGACY_COGITO_INCLUDE_EXTENSIONS.length &&
    LEGACY_COGITO_INCLUDE_EXTENSIONS.every(function (extension) {
      return includeExtensions.includes(extension)
    })

  let nextIncludes = includeExtensions
  if (usesLegacyCogitoShort) {
    nextIncludes = [...SOURCE_WATCH_DEFAULTS.includeExtensions]
  } else if (usesLegacyNoImages) {
    nextIncludes = [...includeExtensions, ...SOURCE_IMAGE_EXTENSIONS]
  }

  return {
    enabled: config?.enabled ?? SOURCE_WATCH_DEFAULTS.enabled,
    autoIngest: config?.autoIngest ?? SOURCE_WATCH_DEFAULTS.autoIngest,
    persistExtractedMarkdown:
      config?.persistExtractedMarkdown ?? SOURCE_WATCH_DEFAULTS.persistExtractedMarkdown,
    parsingConcurrency,
    ingestConcurrency,
    includeExtensions: nextIncludes,
    excludeExtensions: normalizeExtensions(
      config?.excludeExtensions ?? SOURCE_WATCH_DEFAULTS.excludeExtensions
    ),
    excludeDirs: normalizeList(config?.excludeDirs ?? SOURCE_WATCH_DEFAULTS.excludeDirs),
    excludeGlobs: normalizeList(config?.excludeGlobs ?? SOURCE_WATCH_DEFAULTS.excludeGlobs),
    maxFileSizeMb: Math.max(
      1,
      Math.min(4096, Number(config?.maxFileSizeMb) || SOURCE_WATCH_DEFAULTS.maxFileSizeMb)
    ),
    delayMs: Math.max(200, Number(config?.delayMs) || SOURCE_WATCH_DEFAULTS.delayMs)
  }
}

function readSourceWatchConfig(): SourceWatchConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return normalizeSourceWatchConfig(SOURCE_WATCH_DEFAULTS)
    }
    const parsed = JSON.parse(raw) as Partial<SourceWatchConfig>
    return normalizeSourceWatchConfig(parsed)
  } catch (error) {
    console.warn('[source-watch-config] read failed', error)
    return normalizeSourceWatchConfig(SOURCE_WATCH_DEFAULTS)
  }
}

function writeSourceWatchConfig(config: SourceWatchConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSourceWatchConfig(config)))
  } catch (error) {
    console.warn('[source-watch-config] write failed', error)
  }
}

function patchSourceWatchConfig(patch: Partial<SourceWatchConfig>): SourceWatchConfig {
  const next = normalizeSourceWatchConfig({ ...readSourceWatchConfig(), ...patch })
  writeSourceWatchConfig(next)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('knowledge:source-watch-changed'))
  }
  return next
}

function readWatchAllBases(): boolean {
  try {
    const raw = localStorage.getItem(ALL_BASES_STORAGE_KEY)
    if (raw === null) return false
    return raw === '1' || raw === 'true'
  } catch (error) {
    console.warn('[source-watch-config] read all-bases failed', error)
    return false
  }
}

function writeWatchAllBases(enabled: boolean): void {
  try {
    localStorage.setItem(ALL_BASES_STORAGE_KEY, enabled ? '1' : '0')
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('knowledge:source-watch-changed'))
    }
  } catch (error) {
    console.warn('[source-watch-config] write all-bases failed', error)
  }
}

function findSourceWatchExtension(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  if (!name || !name.includes('.')) return ''
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

function matchesGlob(path: string, pattern: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  const name = normalized.split('/').pop() ?? normalized
  const re = wildcardToRegExp(pattern)
  return re.test(name) || re.test(normalized)
}

function pathMatchesExcludedDir(path: string, excludedDir: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  const dir = excludedDir.replace(/\\/g, '/').toLowerCase()
  if (!dir) return false
  if (dir.includes('/')) {
    return (
      normalized === dir ||
      normalized.includes(`/${dir}/`) ||
      normalized.startsWith(`${dir}/`)
    )
  }
  return normalized.split('/').some(function (part) {
    return part === dir
  })
}

function isPathAllowedBySourceWatch(path: string, config: SourceWatchConfig): boolean {
  const cfg = normalizeSourceWatchConfig(config)
  const normalized = path.replace(/\\/g, '/')
  if (cfg.excludeDirs.some(function (dir) {
    return pathMatchesExcludedDir(normalized, dir)
  })) {
    return false
  }
  if (cfg.excludeGlobs.some(function (pattern) {
    return matchesGlob(normalized, pattern)
  })) {
    return false
  }
  const name = normalized.split('/').filter(Boolean).pop() ?? ''
  if (!name || name.startsWith('.')) return false
  const ext = findSourceWatchExtension(normalized)
  if (ext && cfg.excludeExtensions.includes(ext)) return false
  if (cfg.includeExtensions.length > 0 && (!ext || !cfg.includeExtensions.includes(ext))) {
    return false
  }
  return true
}

/** @deprecated 使用 isPathAllowedBySourceWatch */
function pathMatchesWatch(path: string, config: SourceWatchConfig): boolean {
  return isPathAllowedBySourceWatch(path, config)
}

export {
  ALL_BASES_STORAGE_KEY,
  MAX_USER_CONCURRENCY,
  MIN_USER_CONCURRENCY,
  SOURCE_WATCH_DEFAULTS,
  SOURCE_WATCH_FILE_TYPE_GROUPS,
  findSourceWatchExtension,
  isPathAllowedBySourceWatch,
  normalizeSourceWatchConfig,
  pathMatchesWatch,
  patchSourceWatchConfig,
  readSourceWatchConfig,
  readWatchAllBases,
  writeSourceWatchConfig,
  writeWatchAllBases
}
export type { SourceWatchConfig, SourceWatchFileTypeGroup }
