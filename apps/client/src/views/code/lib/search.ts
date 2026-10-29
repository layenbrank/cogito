/**
 * 工作区搜索的匹配器与批量替换。
 *
 * 检索走 Rust（`workspaceFiles:content`，快且能套 git 索引）；替换留在前端，
 * 用与用户所见一致的 JS RegExp 重新扫描每个文件 —— 避免正则方言差异导致
 * 「预览到的命中」和「实际被替换的位置」对不上。
 */
import { useCodeStore } from '@/stores/code'
import { readCodeFile, writeCodeFile } from '@/views/code/lib/fs.ts'
import { findModel } from '@/views/code/lib/monaco-models.ts'
import { buildMatcher } from '@/views/code/lib/search-query.ts'
import type { SearchQuery } from '@/views/code/lib/search-query.ts'

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

/** 展开 JS 替换模板：`$$` / `$&` / `$`` / `$'` / `$n` */
function expandRegexReplacement(replacement: string, match: RegExpExecArray): string {
  return replacement.replace(/\$\$|\$&|\$`|\$'|\$(\d+)/g, function (token, group) {
    if (token === '$$') return '$'
    if (token === '$&') return match[0]
    if (token === '$`') return match.input.slice(0, match.index)
    if (token === "$'") return match.input.slice(match.index + match[0].length)
    const index = Number(group)
    return match[index] ?? token
  })
}

function replaceContent(
  content: string,
  matcher: RegExp,
  query: SearchQuery,
  replacement: string,
  isPreserveCase: boolean
): string {
  if (!isPreserveCase && query.isRegex) {
    return content.replace(matcher, replacement)
  }
  if (!isPreserveCase) {
    return content.replace(matcher, function () {
      return replacement
    })
  }

  matcher.lastIndex = 0
  let out = ''
  let last = 0
  let found: RegExpExecArray | null
  while ((found = matcher.exec(content)) !== null) {
    out += content.slice(last, found.index)
    const expanded = query.isRegex
      ? expandRegexReplacement(replacement, found)
      : replacement
    out += preserveCase(found[0], expanded)
    last = found.index + found[0].length
    if (found[0].length === 0) {
      matcher.lastIndex += 1
    }
  }
  out += content.slice(last)
  return out
}

/**
 * 逐个文件替换并写盘。
 *
 * 已打开的模型同步为新内容并标记为已保存 —— 磁盘已经改过了，再留着「未保存」会误导。
 */
async function replaceInFiles(params: {
  paths: string[]
  query: SearchQuery
  replacement: string
  isPreserveCase?: boolean
}): Promise<ReplaceOutcome> {
  const matcher = buildMatcher(params.query)
  if (!matcher) throw new Error('搜索内容不能为空')

  const isPreserveCase = Boolean(params.isPreserveCase)
  const changed: ReplaceOutcome['changed'] = []
  const failed: ReplaceOutcome['failed'] = []

  for (const path of params.paths) {
    try {
      const content = await readCodeFile(path)
      const next = replaceContent(
        content,
        matcher,
        params.query,
        params.replacement,
        isPreserveCase
      )
      if (next === content) continue
      const count = content.match(matcher)?.length ?? 0
      await writeCodeFile(path, next)
      const model = findModel(path)
      if (model && !model.isDisposed()) model.setValue(next)
      const tab = useCodeStore.getState().tabs.find(function (item) {
        return item.path === path
      })
      if (tab) useCodeStore.getState().toMarkSaved(tab.id)
      changed.push({ path, count })
    } catch (error) {
      console.error('[code] replace failed', path, error)
      failed.push({
        path,
        message: error instanceof Error ? error.message : '替换失败'
      })
    }
  }
  return { changed, failed }
}

export { replaceInFiles, preserveCase }
export type { SearchQuery, ReplaceOutcome }
