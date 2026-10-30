/**
 * 按文件名 / 扩展名选 Lucide 图标，供附件芯片与文件消息共用。
 */

interface FileNameIconHint {
  icon: string
  className: string
}

const FALLBACK: FileNameIconHint = {
  icon: 'lucide:file',
  className: 'text-muted-foreground'
}

const BY_NAME: Record<string, FileNameIconHint> = {
  'package.json': { icon: 'lucide:package', className: 'text-emerald-600 dark:text-emerald-400' },
  'tsconfig.json': { icon: 'lucide:file-cog', className: 'text-sky-600 dark:text-sky-400' },
  'readme.md': { icon: 'lucide:book-open', className: 'text-sky-600 dark:text-sky-400' },
  dockerfile: { icon: 'lucide:container', className: 'text-sky-600 dark:text-sky-400' },
  '.gitignore': { icon: 'lucide:git-branch', className: 'text-orange-600 dark:text-orange-400' },
  '.env': { icon: 'lucide:key-round', className: 'text-lime-600 dark:text-lime-400' },
  '.env.local': { icon: 'lucide:key-round', className: 'text-lime-600 dark:text-lime-400' }
}

const BY_EXT: Record<string, FileNameIconHint> = {
  ts: { icon: 'lucide:file-type', className: 'text-sky-600 dark:text-sky-400' },
  tsx: { icon: 'lucide:file-type', className: 'text-sky-500 dark:text-sky-400' },
  mts: { icon: 'lucide:file-type', className: 'text-sky-600 dark:text-sky-400' },
  cts: { icon: 'lucide:file-type', className: 'text-sky-600 dark:text-sky-400' },
  js: { icon: 'lucide:file-code-2', className: 'text-amber-500 dark:text-amber-400' },
  jsx: { icon: 'lucide:file-code-2', className: 'text-amber-500 dark:text-amber-400' },
  mjs: { icon: 'lucide:file-code-2', className: 'text-amber-500 dark:text-amber-400' },
  cjs: { icon: 'lucide:file-code-2', className: 'text-amber-500 dark:text-amber-400' },
  json: { icon: 'lucide:file-json', className: 'text-amber-600 dark:text-amber-400' },
  jsonc: { icon: 'lucide:file-json', className: 'text-amber-600 dark:text-amber-400' },
  md: { icon: 'lucide:file-text', className: 'text-slate-600 dark:text-slate-300' },
  mdx: { icon: 'lucide:file-text', className: 'text-slate-600 dark:text-slate-300' },
  css: { icon: 'lucide:paintbrush', className: 'text-fuchsia-600 dark:text-fuchsia-400' },
  scss: { icon: 'lucide:paintbrush', className: 'text-fuchsia-600 dark:text-fuchsia-400' },
  html: { icon: 'lucide:globe', className: 'text-orange-600 dark:text-orange-400' },
  svg: { icon: 'lucide:image', className: 'text-teal-600 dark:text-teal-400' },
  png: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  jpg: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  jpeg: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  gif: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  webp: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  rs: { icon: 'lucide:file-code-2', className: 'text-orange-600 dark:text-orange-400' },
  py: { icon: 'lucide:file-code-2', className: 'text-yellow-600 dark:text-yellow-400' },
  go: { icon: 'lucide:file-code-2', className: 'text-cyan-600 dark:text-cyan-400' },
  yaml: { icon: 'lucide:file-code', className: 'text-rose-600 dark:text-rose-400' },
  yml: { icon: 'lucide:file-code', className: 'text-rose-600 dark:text-rose-400' },
  toml: { icon: 'lucide:file-code', className: 'text-violet-600 dark:text-violet-400' },
  sh: { icon: 'lucide:terminal', className: 'text-green-600 dark:text-green-400' },
  sql: { icon: 'lucide:database', className: 'text-cyan-700 dark:text-cyan-400' },
  vue: { icon: 'lucide:file-code-2', className: 'text-emerald-600 dark:text-emerald-400' },
  pdf: { icon: 'lucide:file-text', className: 'text-red-600 dark:text-red-400' },
  zip: { icon: 'lucide:file-archive', className: 'text-yellow-700 dark:text-yellow-500' }
}

function parseExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.d.ts')) return 'ts'
  const dot = lower.lastIndexOf('.')
  if (dot <= 0 || dot === lower.length - 1) return ''
  return lower.slice(dot + 1)
}

function findBaseName(pathOrName: string): string {
  const normalized = pathOrName.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash < 0 ? normalized : normalized.slice(slash + 1)
}

/** 根据路径或文件名返回图标与配色 */
function findFileNameIcon(pathOrName: string): FileNameIconHint {
  const base = findBaseName(pathOrName)
  const lower = base.toLowerCase()
  const byName = BY_NAME[lower]
  if (byName) return byName
  const ext = parseExtension(lower)
  if (ext && BY_EXT[ext]) return BY_EXT[ext]
  return FALLBACK
}

export { findFileNameIcon, findBaseName }
export type { FileNameIconHint }
