/**
 * LLM Wiki 三层目录种子（与 Rust `ensure_wiki_layout` 对齐）。
 * 客户端在建库成功后可再调一次，保证旧库升级。
 */
import { mkdir, writeTextFile, exists } from '@tauri-apps/plugin-fs'

import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'

const WIKI_DIR_RAW_SOURCES = 'raw/sources'
const WIKI_DIR_RAW_PARSED = 'raw/parsed'
const WIKI_DIR_PAGES = 'wiki'
const WIKI_DIR_MEDIA = 'wiki/media'

const SEEDS: readonly { relative: string; content: string; isDir?: boolean }[] = [
  { relative: WIKI_DIR_RAW_SOURCES, content: '', isDir: true },
  { relative: WIKI_DIR_RAW_PARSED, content: '', isDir: true },
  { relative: WIKI_DIR_MEDIA, content: '', isDir: true },
  {
    relative: 'schema.md',
    content: '# Schema\n\n约定 Wiki 结构、frontmatter 与 ingest 规则。由人类与助手共同演进。\n'
  },
  {
    relative: 'purpose.md',
    content: '# Purpose\n\n这个知识库为什么存在？关键问题与研究范围写在这里。\n'
  },
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

async function ensureWikiScaffold(rootPath: string): Promise<void> {
  for (const seed of SEEDS) {
    const absolute = joinPath(rootPath, seed.relative)
    if (seed.isDir) {
      if (!(await exists(absolute))) {
        await mkdir(absolute, { recursive: true })
      }
      continue
    }
    if (await exists(absolute)) continue
    const parent = findParentDir(absolute)
    if (parent && !(await exists(parent))) {
      await mkdir(parent, { recursive: true })
    }
    await writeTextFile(absolute, seed.content)
  }
}

export {
  ensureWikiScaffold,
  SEEDS,
  WIKI_DIR_RAW_SOURCES,
  WIKI_DIR_RAW_PARSED,
  WIKI_DIR_PAGES,
  WIKI_DIR_MEDIA
}
