/**
 * 提示词模板里的 `{name}` 占位符。
 *
 * 只认「以字母或下划线开头」的变量名：模板里常见的 JSON 片段、代码块
 * (`{ "a": 1 }` / `{...}`) 不会被误当成变量，提示词面板里的变量芯片
 * 也就不会数错。
 */

const PROMPT_VARIABLE_PATTERN = /\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g

/** 按出现顺序返回去重后的变量名（同一变量只提示一次）。 */
function parsePromptVariables(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(PROMPT_VARIABLE_PATTERN)) {
    const name = match[1]
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function countPromptVariables(text: string): number {
  return parsePromptVariables(text).length
}

/**
 * 用给定值填充模板；没给值的变量原样保留。
 * 提示词插入输入框时就该保持 `{name}` 文本，留给用户自己在上面改。
 */
function fillPromptVariables(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PROMPT_VARIABLE_PATTERN, function (raw, name: string) {
    const value = values[name]
    return value === undefined ? raw : value
  })
}

export { countPromptVariables, fillPromptVariables, parsePromptVariables }
