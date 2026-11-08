/**
 * LLM Wiki 三层目录种子（与 Rust `ensure_wiki_layout` 对齐）。
 * purpose / schema 按场景模板写入；客户端在建库成功后调用。
 */
import { mkdir, writeTextFile, exists } from '@tauri-apps/plugin-fs'

import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'
import {
  findWikiTemplate,
  WIKI_TEMPLATE_GENERAL,
  type WikiTemplate
} from '@/views/knowledge/lib/wiki-templates.ts'

const WIKI_DIR_RAW_SOURCES = 'raw/sources'
const WIKI_DIR_RAW_PARSED = 'raw/parsed'
const WIKI_DIR_PAGES = 'wiki'
const WIKI_DIR_MEDIA = 'wiki/media'
const WIKI_DIR_AGENT = '.agent'

const BASE_SEEDS: readonly { relative: string; content: string; isDir?: boolean }[] = [
  { relative: WIKI_DIR_RAW_SOURCES, content: '', isDir: true },
  { relative: WIKI_DIR_RAW_PARSED, content: '', isDir: true },
  { relative: WIKI_DIR_MEDIA, content: '', isDir: true },
  { relative: WIKI_DIR_AGENT, content: '', isDir: true },
  {
    relative: 'wiki/index.md',
    content: '---\ntitle: Index\ntype: index\n---\n\n# Index\n\n内容目录。ingest 后由助手维护。\n'
  },
  {
    relative: 'wiki/log.md',
    content: '---\ntitle: Log\ntype: log\n---\n\n# Log\n\n## 操作记录\n\n'
  },
  {
    relative: 'wiki/overview.md',
    content: '---\ntitle: Overview\ntype: overview\n---\n\n# Overview\n\n全局概要，随 ingest 更新。\n'
  }
]

async function writeIfMissing(absolute: string, content: string): Promise<void> {
  if (await exists(absolute)) return
  const parent = findParentDir(absolute)
  if (parent && !(await exists(parent))) {
    await mkdir(parent, { recursive: true })
  }
  await writeTextFile(absolute, content)
}

async function ensureDir(absolute: string): Promise<void> {
  if (!(await exists(absolute))) {
    await mkdir(absolute, { recursive: true })
  }
}

async function writeBaseSeeds(rootPath: string): Promise<void> {
  for (const seed of BASE_SEEDS) {
    const absolute = joinPath(rootPath, seed.relative)
    if (seed.isDir) {
      await ensureDir(absolute)
      continue
    }
    await writeIfMissing(absolute, seed.content)
  }
}

async function writeTemplateDocs(
  rootPath: string,
  template: WikiTemplate,
  options: { force: boolean }
): Promise<void> {
  const purposePath = joinPath(rootPath, 'purpose.md')
  const schemaPath = joinPath(rootPath, 'schema.md')
  if (options.force) {
    await writeTextFile(purposePath, template.purpose)
    await writeTextFile(schemaPath, template.schema)
  } else {
    await writeIfMissing(purposePath, template.purpose)
    await writeIfMissing(schemaPath, template.schema)
  }
  for (const relative of template.extraDirs) {
    await ensureDir(joinPath(rootPath, relative))
  }
}

/** 幂等脚手架：缺什么补什么，不覆盖已有 purpose/schema。 */
async function ensureWikiScaffold(
  rootPath: string,
  templateId: string = WIKI_TEMPLATE_GENERAL
): Promise<void> {
  await writeBaseSeeds(rootPath)
  await writeTemplateDocs(rootPath, findWikiTemplate(templateId), { force: false })
}

/** 新建库：覆盖写入场景模板的 purpose/schema。 */
async function writeWikiTemplate(rootPath: string, templateId: string): Promise<void> {
  await writeBaseSeeds(rootPath)
  await writeTemplateDocs(rootPath, findWikiTemplate(templateId), { force: true })
}

export {
  ensureWikiScaffold,
  writeWikiTemplate,
  BASE_SEEDS,
  WIKI_DIR_RAW_SOURCES,
  WIKI_DIR_RAW_PARSED,
  WIKI_DIR_PAGES,
  WIKI_DIR_MEDIA,
  WIKI_DIR_AGENT
}
