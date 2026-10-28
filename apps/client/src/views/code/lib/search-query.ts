/**
 * 搜索表达式构造（纯函数，便于单测）。
 *
 * 前端只负责「把开关翻译成正则」；真正的检索在 Rust，
 * 替换时用同一份规则重扫，保证「看到的命中 = 被替换的位置」。
 */
interface SearchQuery {
  query: string
  isRegex: boolean
  isCaseSensitive: boolean
  isWholeWord: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPattern(query: SearchQuery): string {
  const base = query.isRegex ? query.query : escapeRegExp(query.query)
  return query.isWholeWord ? `\\b${base}\\b` : base
}

/** 全局匹配器；表达式非法或内容为空时返回 null */
function buildMatcher(query: SearchQuery): RegExp | null {
  if (!query.query.trim()) return null
  try {
    return new RegExp(buildPattern(query), query.isCaseSensitive ? 'g' : 'gi')
  } catch (error) {
    // 表达式非法由 `isValidQuery` 在输入框旁提示，这里只留痕
    console.debug('[code] 搜索表达式无效', error)
    return null
  }
}

/** 表达式是否可用（供输入框提示） */
function isValidQuery(query: SearchQuery): boolean {
  if (!query.query.trim()) return true
  return buildMatcher(query) !== null
}

export { escapeRegExp, buildPattern, buildMatcher, isValidQuery }
export type { SearchQuery }
