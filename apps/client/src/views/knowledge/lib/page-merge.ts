/**
 * 同 path 页合并：sources 数组并集 + 正文拼接（P1 简化版）。
 */
function parseFrontmatter(content: string): { fm: string; body: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) return null
  return { fm: match[1] ?? '', body: match[2] ?? '' }
}

function collectSources(fm: string): string[] {
  const line = fm.match(/^sources:\s*\[([^\]]*)\]/m)
  if (!line?.[1]) return []
  const out: string[] = []
  const re = /["']([^"']+)["']/g
  let match: RegExpExecArray | null
  while ((match = re.exec(line[1]))) {
    out.push(match[1])
  }
  return out
}

function writeSources(fm: string, sources: string[]): string {
  const yaml = `sources: [${sources
    .map(function (item) {
      return JSON.stringify(item)
    })
    .join(', ')}]`
  if (/^sources:\s*\[/m.test(fm)) {
    return fm.replace(/^sources:\s*\[[^\]]*\]/m, yaml)
  }
  return `${fm.trimEnd()}\n${yaml}`
}

function mergePageContent(existing: string, incoming: string): string {
  const left = parseFrontmatter(existing)
  const right = parseFrontmatter(incoming)
  if (!right) return incoming
  if (!left) return incoming

  const sources = [...new Set([...collectSources(left.fm), ...collectSources(right.fm)])]
  const fm = writeSources(right.fm, sources)
  const bodyLeft = left.body.trim()
  const bodyRight = right.body.trim()
  let body = bodyRight
  if (bodyLeft && bodyLeft !== bodyRight && !bodyRight.includes(bodyLeft.slice(0, 120))) {
    body = `${bodyRight}\n\n## 既有内容保留\n\n${bodyLeft}`
  }
  return `---\n${fm}\n---\n\n${body}\n`
}

export { collectSources, mergePageContent, parseFrontmatter }
