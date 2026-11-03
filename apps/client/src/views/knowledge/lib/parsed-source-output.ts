/**
 * 将文档解析正文落到 raw/parsed（对齐 llm_wiki persistExtractedMarkdown）。
 */
import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'

import { findFileName, findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'

const PARSED_MARKDOWN_EXTENSIONS = new Set([
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
  'ods',
  'odp',
  'rtf',
  'epub',
  'mobi',
  'org'
])

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * raw/sources/report.pdf → raw/parsed/report.pdf.md
 * 保留原扩展名避免 report.pdf / report.docx 撞名。
 */
function findParsedMarkdownOutputPath(
  rootPath: string,
  sourcePath: string
): string | null {
  const project = normalizePath(rootPath).replace(/\/+$/, '')
  const source = normalizePath(sourcePath)
  const sourceRoot = `${project}/raw/sources`
  const relative = source.toLowerCase().startsWith('raw/sources/')
    ? source.slice('raw/sources/'.length)
    : source.toLowerCase().startsWith(sourceRoot.toLowerCase() + '/')
      ? source.slice(sourceRoot.length + 1)
      : null
  if (!relative) return null
  if (
    relative.split('/').some(function (part) {
      return !part || part === '.' || part === '..'
    })
  ) {
    return null
  }

  const fileName = findFileName(relative)
  const extension = fileName.includes('.')
    ? (fileName.split('.').pop()?.toLowerCase() ?? '')
    : ''
  if (!PARSED_MARKDOWN_EXTENSIONS.has(extension)) return null
  return joinPath(project, `raw/parsed/${relative}.md`)
}

async function persistParsedMarkdown(
  rootPath: string,
  sourcePath: string,
  markdown: string
): Promise<string | null> {
  const outputPath = findParsedMarkdownOutputPath(rootPath, sourcePath)
  if (!outputPath) return null
  const parent = findParentDir(outputPath)
  if (parent && !(await exists(parent))) {
    await mkdir(parent, { recursive: true })
  }
  await writeTextFile(outputPath, markdown)
  return outputPath
}

async function removeParsedMarkdown(
  rootPath: string,
  sourcePath: string
): Promise<void> {
  const outputPath = findParsedMarkdownOutputPath(rootPath, sourcePath)
  if (!outputPath) return
  try {
    if (await exists(outputPath)) {
      await remove(outputPath)
    }
  } catch (error) {
    console.warn('[parsed-source-output] remove failed', outputPath, error)
  }
}

async function moveParsedMarkdown(
  rootPath: string,
  oldSourcePath: string,
  newSourcePath: string
): Promise<void> {
  const oldOutput = findParsedMarkdownOutputPath(rootPath, oldSourcePath)
  const newOutput = findParsedMarkdownOutputPath(rootPath, newSourcePath)
  if (!oldOutput || !newOutput || oldOutput === newOutput) return
  let markdown: string
  try {
    if (!(await exists(oldOutput))) return
    markdown = await readTextFile(oldOutput)
  } catch (error) {
    console.warn('[parsed-source-output] read old failed', oldOutput, error)
    return
  }
  const parent = findParentDir(newOutput)
  if (parent && !(await exists(parent))) {
    await mkdir(parent, { recursive: true })
  }
  await writeTextFile(newOutput, markdown)
  try {
    await remove(oldOutput)
  } catch (error) {
    console.warn('[parsed-source-output] stale remove failed', oldOutput, error)
  }
}

export {
  findParsedMarkdownOutputPath,
  moveParsedMarkdown,
  persistParsedMarkdown,
  removeParsedMarkdown
}
