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
 * 逐个文件替换并写盘。
 *
 * 已打开的模型同步为新内容并标记为已保存 —— 磁盘已经改过了，再留着「未保存」会误导。
 */
async function replaceInFiles(params: {
  paths: string[]
  query: SearchQuery
  replacement: string
}): Promise<ReplaceOutcome> {
  const matcher = buildMatcher(params.query)
  if (!matcher) throw new Error('搜索内容不能为空')

  const changed: ReplaceOutcome['changed'] = []
  const failed: ReplaceOutcome['failed'] = []

  for (const path of params.paths) {
    try {
      const content = await readCodeFile(path)
      // 非正则模式下 `$1` 不该被当成捕获组引用
      const next = params.query.isRegex
        ? content.replace(matcher, params.replacement)
        : content.replace(matcher, function () {
            return params.replacement
          })
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

export { replaceInFiles }
export type { SearchQuery, ReplaceOutcome }
