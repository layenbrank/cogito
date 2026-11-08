/**
 * 读取当前库的 purpose / schema / overview，供 dock 与 playbook 注入。
 */
import { exists, readTextFile } from '@tauri-apps/plugin-fs'

import { joinPath } from '@/views/knowledge/lib/path.ts'
import {
  findRetrievalModeHint,
  readRetrievalMode
} from '@/views/knowledge/lib/retrieval-mode.ts'

const CONTEXT_BUDGET = 6_000

interface WikiProjectContext {
  purpose: string
  schema: string
  overview: string
  retrievalHint: string
}

async function readWikiDoc(rootPath: string, relative: string): Promise<string> {
  const absolute = joinPath(rootPath, relative)
  try {
    if (!(await exists(absolute))) return ''
    return (await readTextFile(absolute)).slice(0, CONTEXT_BUDGET)
  } catch (error) {
    console.warn('[wiki-context] read failed:', relative, error)
    return ''
  }
}

function settledText(result: PromiseSettledResult<string>, label: string): string {
  if (result.status === 'fulfilled') return result.value
  console.warn(`[wiki-context] ${label} rejected:`, result.reason)
  return ''
}

async function fetchWikiProjectContext(
  rootPath: string | null | undefined
): Promise<WikiProjectContext> {
  const retrievalHint = findRetrievalModeHint(readRetrievalMode())
  if (!rootPath) {
    return { purpose: '', schema: '', overview: '', retrievalHint }
  }
  const settled = await Promise.allSettled([
    readWikiDoc(rootPath, 'purpose.md'),
    readWikiDoc(rootPath, 'schema.md'),
    readWikiDoc(rootPath, 'wiki/overview.md')
  ])
  return {
    purpose: settledText(settled[0], 'purpose.md'),
    schema: settledText(settled[1], 'schema.md'),
    overview: settledText(settled[2], 'wiki/overview.md'),
    retrievalHint
  }
}

function formatWikiContextBlock(context: WikiProjectContext): string {
  return [
    '## 当前库说明书（只读，勿改写 index/log/overview）',
    '',
    '### purpose.md',
    context.purpose || '(空 — 请先用场景模板建库或导入示例库)',
    '',
    '### schema.md',
    context.schema || '(空)',
    '',
    '### wiki/overview.md',
    context.overview || '(空)',
    '',
    '### 检索模式',
    context.retrievalHint
  ].join('\n')
}

export {
  CONTEXT_BUDGET,
  fetchWikiProjectContext,
  formatWikiContextBlock,
  readWikiDoc,
  type WikiProjectContext
}
