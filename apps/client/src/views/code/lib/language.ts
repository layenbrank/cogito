/**
 * 扩展名 → Monaco languageId。
 *
 * 优先用 Monaco 自带语言注册表（`languages.getLanguages()` 的 extensions/aliases）生成索引，
 * 避免手写字典永远追不上 basic-languages；monaco 未加载（agent diff 懒加载路径）或查不到时
 * 回落手写表，保证任何时候都不抛错。
 */
import { findMonaco } from '@/lib/monaco-loader.ts'
import { findExtension, findFileName } from '@/views/code/lib/path.ts'

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  rs: 'rust',
  py: 'python',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  vue: 'html',
  graphql: 'graphql',
  gql: 'graphql',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  dart: 'dart',
  proto: 'proto',
  ini: 'ini',
  properties: 'ini',
  http: 'http',
  txt: 'plaintext'
}

/** 无扩展名 / 特殊文件名 */
const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.env': 'ini'
}

/** 注册表给的语言不理想时的人工覆盖 */
const OVERRIDES: Record<string, string> = {
  vue: 'html',
  toml: 'ini',
  mdx: 'markdown',
  mts: 'typescript',
  cts: 'typescript'
}

interface MonacoLanguageLike {
  id: string
  extensions?: string[]
  filenames?: string[]
}

let extensionIndex: Map<string, string> | null = null
let filenameIndex: Map<string, string> | null = null

/** 纯函数：把 monaco 语言数组折叠成 ext → id 索引（首个注册者优先） */
function buildLanguageIndex(languages: MonacoLanguageLike[]): {
  byExtension: Map<string, string>
  byFilename: Map<string, string>
} {
  const byExtension = new Map<string, string>()
  const byFilename = new Map<string, string>()
  for (const language of languages) {
    for (const ext of language.extensions ?? []) {
      const key = ext.replace(/^\./, '').toLowerCase()
      if (key && !byExtension.has(key)) byExtension.set(key, language.id)
    }
    for (const name of language.filenames ?? []) {
      const key = name.toLowerCase()
      if (key && !byFilename.has(key)) byFilename.set(key, language.id)
    }
  }
  return { byExtension, byFilename }
}

function ensureIndex(): void {
  if (extensionIndex) return
  try {
    const monaco = findMonaco()
    const built = buildLanguageIndex(monaco.languages.getLanguages())
    extensionIndex = built.byExtension
    filenameIndex = built.byFilename
  } catch (error) {
    // monaco 尚未加载：本次直接回落手写表，下次调用再试
    console.debug('[code/language] 语言注册表不可用，回落手写表', error)
  }
}

function findLanguageId(path: string): string {
  const name = findFileName(path).toLowerCase()
  ensureIndex()
  const byName = filenameIndex?.get(name) ?? FILENAME_LANGUAGE[name]
  if (byName) return byName

  const ext = findExtension(path)
  if (!ext) return 'plaintext'
  const override = OVERRIDES[ext]
  if (override) return override
  return extensionIndex?.get(ext) ?? EXTENSION_LANGUAGE[ext] ?? 'plaintext'
}

export { EXTENSION_LANGUAGE, OVERRIDES, buildLanguageIndex, findLanguageId }
