/**
 * 工作区搜索的批量替换。
 *
 * 检索与替换都走 Rust（`workspaceFiles:content` / `workspaceFiles:replace`），
 * 共用同一套 regex 语义；前端只负责同步 Monaco 模型与 tab 脏标记。
 *
 * `preserveCase` 仍导出，作为与 Rust 对齐的契约单测。
 */
import { WorkspaceFiles } from '@/lib/workspace-files'
import { useCodeStore } from '@/stores/code'
import { findModel } from '@/views/code/lib/monaco-models.ts'
import { isValidQuery, type SearchQuery } from '@/views/code/lib/search-query.ts'

interface ReplaceOutcome {
  /** 替换成功的文件（绝对路径）与命中次数 */
  changed: { path: string; count: number }[]
  failed: { path: string; message: string }[]
}

/**
 * 按命中文本的大小写形态改写替换串（对齐 VS Code Preserve Case）。
 *
 * - 全大写 / 全小写 → 整体同态
 * - 首字母大写其余小写 → Title 态
 * - 其它 → 逐字符映射，多余字符沿用末位大小写
 */
function preserveCase(matched: string, replacement: string): string {
  if (!matched || !replacement) return replacement
  if (matched === matched.toUpperCase()) return replacement.toUpperCase()
  if (matched === matched.toLowerCase()) return replacement.toLowerCase()

  const head = matched[0] ?? ''
  const isTitle =
    head === head.toUpperCase() && matched.slice(1) === matched.slice(1).toLowerCase()
  if (isTitle) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  }

  let out = ''
  for (let index = 0; index < replacement.length; index += 1) {
    const source = matched[Math.min(index, matched.length - 1)] ?? ''
    const ch = replacement[index] ?? ''
    out +=
      source === source.toUpperCase() && source !== source.toLowerCase()
        ? ch.toUpperCase()
        : ch.toLowerCase()
  }
  return out
}

/**
 * 调用 Rust 批量替换，再把已打开模型同步为磁盘新内容。
 */
async function replaceInFiles(params: {
  paths: string[]
  query: SearchQuery
  replacement: string
  isPreserveCase?: boolean
}): Promise<ReplaceOutcome> {
  if (!isValidQuery(params.query) || !params.query.query.trim()) {
    throw new Error('搜索内容不能为空')
  }
  const root = useCodeStore.getState().workspaceRoot
  if (!root) throw new Error('尚未打开工作区')

  const outcome = await WorkspaceFiles.replace({
    root,
    paths: params.paths,
    query: params.query.query,
    isRegex: params.query.isRegex,
    isCaseSensitive: params.query.isCaseSensitive,
    isWholeWord: params.query.isWholeWord,
    replacement: params.replacement,
    isPreserveCase: Boolean(params.isPreserveCase)
  })

  for (const item of outcome.changed) {
    const model = findModel(item.path)
    if (model && !model.isDisposed()) model.setValue(item.content)
    const tab = useCodeStore.getState().tabs.find(function (entry) {
      return entry.path === item.path
    })
    if (tab) useCodeStore.getState().toMarkSaved(tab.id)
  }

  for (const item of outcome.failed) {
    console.error('[code] replace failed', item.path, item.message)
  }

  return {
    changed: outcome.changed.map(function (item) {
      return { path: item.path, count: item.count }
    }),
    failed: outcome.failed
  }
}

export { replaceInFiles, preserveCase }
export type { SearchQuery, ReplaceOutcome }
