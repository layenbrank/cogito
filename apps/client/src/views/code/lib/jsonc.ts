/**
 * JSONC（带注释与尾逗号的 JSON）解析。
 *
 * tsconfig.json / .vscode/*.json 都允许 `//`、`/* *\/` 与尾逗号，`JSON.parse` 会直接抛。
 * 这里只做「剥注释 + 去尾逗号」，语法校验仍交给 `JSON.parse`；字符串内的注释符与逗号不误伤。
 */

interface JsoncParseSuccess {
  ok: true
  value: unknown
}

interface JsoncParseFailure {
  ok: false
  reason: string
}

type JsoncParseResult = JsoncParseSuccess | JsoncParseFailure

/** 去掉 // 与 /* *\/ 注释，字符串内（含转义）原样保留 */
function stripComments(text: string): string {
  let out = ''
  let index = 0
  let inString = false
  while (index < text.length) {
    const char = text[index]
    if (inString) {
      out += char
      if (char === '\\' && index + 1 < text.length) {
        out += text[index + 1]
        index += 2
        continue
      }
      if (char === '"') inString = false
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index += 1
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      index += 2
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    out += char
    index += 1
  }
  return out
}

/** 删除对象 / 数组末尾多余的逗号；字符串内的逗号不受影响 */
function stripTrailingCommas(text: string): string {
  let out = ''
  let index = 0
  let inString = false
  while (index < text.length) {
    const char = text[index]
    if (inString) {
      out += char
      if (char === '\\' && index + 1 < text.length) {
        out += text[index + 1]
        index += 2
        continue
      }
      if (char === '"') inString = false
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index += 1
      continue
    }
    if (char === ',') {
      let lookahead = index + 1
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1
      if (text[lookahead] === '}' || text[lookahead] === ']') {
        index += 1
        continue
      }
    }
    out += char
    index += 1
  }
  return out
}

function stripJsonc(text: string): string {
  return stripTrailingCommas(stripComments(text))
}

function parseJsonc(text: string): JsoncParseResult {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return { ok: false, reason: '文件为空' }
  try {
    return { ok: true, value: JSON.parse(stripJsonc(trimmed)) as unknown }
  } catch (error) {
    // 语法错误是预期路径（用户手改坏了 json），落一条 debug 便于排查
    console.debug('[code/jsonc] JSONC 解析失败', error)
    return { ok: false, reason: error instanceof Error ? error.message : 'JSONC 解析失败' }
  }
}

export { parseJsonc, stripJsonc }
export type { JsoncParseResult, JsoncParseSuccess, JsoncParseFailure }
