/**
 * 文件树 / 标签页图标：按文件名与扩展名点缀，保持 Lucide 线稿风格。
 */

interface FileIconHint {
  icon: string
  className: string
}

const FOLDER: FileIconHint = {
  icon: 'lucide:folder',
  className: 'text-amber-500 dark:text-amber-400'
}

const FOLDER_OPEN: FileIconHint = {
  icon: 'lucide:folder-open',
  className: 'text-amber-500 dark:text-amber-400'
}

const FILE_FALLBACK: FileIconHint = {
  icon: 'lucide:file',
  className: 'text-muted-foreground'
}

/** 完整文件名（小写）优先于扩展名 */
const BY_NAME: Record<string, FileIconHint> = {
  'package.json': { icon: 'lucide:package', className: 'text-emerald-600 dark:text-emerald-400' },
  'package-lock.json': {
    icon: 'lucide:package',
    className: 'text-emerald-600/80 dark:text-emerald-400/80'
  },
  'pnpm-lock.yaml': {
    icon: 'lucide:lock',
    className: 'text-amber-700 dark:text-amber-300'
  },
  'pnpm-workspace.yaml': {
    icon: 'lucide:folders',
    className: 'text-amber-600 dark:text-amber-400'
  },
  'yarn.lock': { icon: 'lucide:lock', className: 'text-blue-600 dark:text-blue-400' },
  'cargo.toml': { icon: 'lucide:box', className: 'text-orange-600 dark:text-orange-400' },
  'cargo.lock': { icon: 'lucide:lock', className: 'text-orange-700/80 dark:text-orange-300/80' },
  dockerfile: { icon: 'lucide:container', className: 'text-sky-600 dark:text-sky-400' },
  'docker-compose.yml': {
    icon: 'lucide:container',
    className: 'text-sky-600 dark:text-sky-400'
  },
  'docker-compose.yaml': {
    icon: 'lucide:container',
    className: 'text-sky-600 dark:text-sky-400'
  },
  'compose.yaml': { icon: 'lucide:container', className: 'text-sky-600 dark:text-sky-400' },
  'compose.yml': { icon: 'lucide:container', className: 'text-sky-600 dark:text-sky-400' },
  'readme.md': { icon: 'lucide:book-open', className: 'text-sky-600 dark:text-sky-400' },
  'readme': { icon: 'lucide:book-open', className: 'text-sky-600 dark:text-sky-400' },
  license: { icon: 'lucide:scale', className: 'text-muted-foreground' },
  'license.md': { icon: 'lucide:scale', className: 'text-muted-foreground' },
  '.gitignore': { icon: 'lucide:git-branch', className: 'text-orange-600 dark:text-orange-400' },
  '.gitattributes': {
    icon: 'lucide:git-branch',
    className: 'text-orange-600/80 dark:text-orange-400/80'
  },
  '.editorconfig': { icon: 'lucide:settings-2', className: 'text-slate-500 dark:text-slate-400' },
  '.env': { icon: 'lucide:key-round', className: 'text-lime-600 dark:text-lime-400' },
  '.env.local': { icon: 'lucide:key-round', className: 'text-lime-600 dark:text-lime-400' },
  '.env.example': {
    icon: 'lucide:key-round',
    className: 'text-lime-600/70 dark:text-lime-400/70'
  },
  'tsconfig.json': { icon: 'lucide:file-cog', className: 'text-sky-600 dark:text-sky-400' },
  'jsconfig.json': { icon: 'lucide:file-cog', className: 'text-amber-600 dark:text-amber-400' },
  'turbo.json': { icon: 'lucide:gauge', className: 'text-red-500 dark:text-red-400' },
  'vitest.config.ts': {
    icon: 'lucide:flask-conical',
    className: 'text-emerald-600 dark:text-emerald-400'
  },
  'vite.config.ts': {
    icon: 'lucide:zap',
    className: 'text-violet-600 dark:text-violet-400'
  },
  'eslint.config.js': {
    icon: 'lucide:shield-check',
    className: 'text-indigo-600 dark:text-indigo-400'
  },
  'eslint.config.mjs': {
    icon: 'lucide:shield-check',
    className: 'text-indigo-600 dark:text-indigo-400'
  },
  'rust-toolchain.toml': {
    icon: 'lucide:wrench',
    className: 'text-orange-600 dark:text-orange-400'
  },
  'rustfmt.toml': {
    icon: 'lucide:paintbrush',
    className: 'text-orange-600 dark:text-orange-400'
  },
  'nginx.conf': { icon: 'lucide:server', className: 'text-green-600 dark:text-green-400' },
  makefile: { icon: 'lucide:hammer', className: 'text-slate-600 dark:text-slate-300' }
}

const BY_EXT: Record<string, FileIconHint> = {
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
  yaml: { icon: 'lucide:file-code', className: 'text-rose-600 dark:text-rose-400' },
  yml: { icon: 'lucide:file-code', className: 'text-rose-600 dark:text-rose-400' },
  toml: { icon: 'lucide:file-code', className: 'text-violet-600 dark:text-violet-400' },
  css: { icon: 'lucide:paintbrush', className: 'text-fuchsia-600 dark:text-fuchsia-400' },
  scss: { icon: 'lucide:paintbrush', className: 'text-fuchsia-600 dark:text-fuchsia-400' },
  less: { icon: 'lucide:paintbrush', className: 'text-fuchsia-600 dark:text-fuchsia-400' },
  html: { icon: 'lucide:globe', className: 'text-orange-600 dark:text-orange-400' },
  htm: { icon: 'lucide:globe', className: 'text-orange-600 dark:text-orange-400' },
  svg: { icon: 'lucide:image', className: 'text-teal-600 dark:text-teal-400' },
  png: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  jpg: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  jpeg: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  gif: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  webp: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  ico: { icon: 'lucide:image', className: 'text-emerald-600 dark:text-emerald-400' },
  rs: { icon: 'lucide:file-code-2', className: 'text-orange-600 dark:text-orange-400' },
  py: { icon: 'lucide:file-code-2', className: 'text-yellow-600 dark:text-yellow-400' },
  go: { icon: 'lucide:file-code-2', className: 'text-cyan-600 dark:text-cyan-400' },
  java: { icon: 'lucide:file-code-2', className: 'text-red-600 dark:text-red-400' },
  kt: { icon: 'lucide:file-code-2', className: 'text-purple-600 dark:text-purple-400' },
  c: { icon: 'lucide:file-code-2', className: 'text-blue-600 dark:text-blue-400' },
  h: { icon: 'lucide:file-code-2', className: 'text-blue-600 dark:text-blue-400' },
  cpp: { icon: 'lucide:file-code-2', className: 'text-blue-600 dark:text-blue-400' },
  hpp: { icon: 'lucide:file-code-2', className: 'text-blue-600 dark:text-blue-400' },
  cs: { icon: 'lucide:file-code-2', className: 'text-violet-600 dark:text-violet-400' },
  sh: { icon: 'lucide:terminal', className: 'text-green-600 dark:text-green-400' },
  bash: { icon: 'lucide:terminal', className: 'text-green-600 dark:text-green-400' },
  zsh: { icon: 'lucide:terminal', className: 'text-green-600 dark:text-green-400' },
  ps1: { icon: 'lucide:terminal', className: 'text-blue-600 dark:text-blue-400' },
  sql: { icon: 'lucide:database', className: 'text-cyan-700 dark:text-cyan-400' },
  graphql: { icon: 'lucide:hexagon', className: 'text-pink-600 dark:text-pink-400' },
  gql: { icon: 'lucide:hexagon', className: 'text-pink-600 dark:text-pink-400' },
  vue: { icon: 'lucide:file-code-2', className: 'text-emerald-600 dark:text-emerald-400' },
  svelte: { icon: 'lucide:file-code-2', className: 'text-orange-600 dark:text-orange-400' },
  conf: { icon: 'lucide:settings-2', className: 'text-slate-600 dark:text-slate-300' },
  ini: { icon: 'lucide:settings-2', className: 'text-slate-600 dark:text-slate-300' },
  env: { icon: 'lucide:key-round', className: 'text-lime-600 dark:text-lime-400' },
  lock: { icon: 'lucide:lock', className: 'text-muted-foreground' },
  zip: { icon: 'lucide:file-archive', className: 'text-yellow-700 dark:text-yellow-500' },
  gz: { icon: 'lucide:file-archive', className: 'text-yellow-700 dark:text-yellow-500' },
  tar: { icon: 'lucide:file-archive', className: 'text-yellow-700 dark:text-yellow-500' },
  '7z': { icon: 'lucide:file-archive', className: 'text-yellow-700 dark:text-yellow-500' },
  rar: { icon: 'lucide:file-archive', className: 'text-yellow-700 dark:text-yellow-500' },
  pdf: { icon: 'lucide:file-text', className: 'text-red-600 dark:text-red-400' },
  csv: { icon: 'lucide:file-spreadsheet', className: 'text-emerald-700 dark:text-emerald-400' },
  xlsx: { icon: 'lucide:file-spreadsheet', className: 'text-emerald-700 dark:text-emerald-400' },
  xls: { icon: 'lucide:file-spreadsheet', className: 'text-emerald-700 dark:text-emerald-400' },
  xml: { icon: 'lucide:file-code', className: 'text-orange-600 dark:text-orange-400' },
  wasm: { icon: 'lucide:cpu', className: 'text-indigo-600 dark:text-indigo-400' },
  map: { icon: 'lucide:map', className: 'text-muted-foreground' },
  log: { icon: 'lucide:scroll-text', className: 'text-muted-foreground' }
}

const FOLDER_BY_NAME: Record<string, FileIconHint> = {
  '.git': { icon: 'lucide:folder-git-2', className: 'text-orange-500 dark:text-orange-400' },
  node_modules: {
    icon: 'lucide:folder-cog',
    className: 'text-emerald-600/80 dark:text-emerald-400/80'
  },
  src: { icon: 'lucide:folder-code', className: 'text-sky-500 dark:text-sky-400' },
  dist: { icon: 'lucide:folder-output', className: 'text-slate-500 dark:text-slate-400' },
  build: { icon: 'lucide:folder-output', className: 'text-slate-500 dark:text-slate-400' },
  public: { icon: 'lucide:folder-open', className: 'text-teal-500 dark:text-teal-400' },
  assets: { icon: 'lucide:folder-open', className: 'text-teal-500 dark:text-teal-400' },
  docs: { icon: 'lucide:folder-open', className: 'text-sky-500 dark:text-sky-400' },
  test: { icon: 'lucide:folder-open', className: 'text-emerald-500 dark:text-emerald-400' },
  tests: { icon: 'lucide:folder-open', className: 'text-emerald-500 dark:text-emerald-400' },
  __tests__: {
    icon: 'lucide:folder-open',
    className: 'text-emerald-500 dark:text-emerald-400'
  }
}

function parseExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.d.ts')) return 'ts'
  if (lower.endsWith('.d.mts')) return 'mts'
  if (lower.endsWith('.d.cts')) return 'cts'
  const dot = lower.lastIndexOf('.')
  if (dot <= 0 || dot === lower.length - 1) return ''
  return lower.slice(dot + 1)
}

function findFileIcon(fileName: string): FileIconHint {
  const lower = fileName.toLowerCase()
  const byName = BY_NAME[lower]
  if (byName) return byName
  const ext = parseExtension(lower)
  if (ext && BY_EXT[ext]) return BY_EXT[ext]
  return FILE_FALLBACK
}

function findFolderIcon(folderName: string, isOpen: boolean): FileIconHint {
  const lower = folderName.toLowerCase()
  const special = FOLDER_BY_NAME[lower]
  if (special) {
    if (!isOpen) return special
    return {
      icon: special.icon.includes('git') ? special.icon : 'lucide:folder-open',
      className: special.className
    }
  }
  return isOpen ? FOLDER_OPEN : FOLDER
}

export { findFileIcon, findFolderIcon }
export type { FileIconHint }
