/**
 * Lint 一键修复：断链建 stub 页；配置持久化。
 */
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs'

import { joinPath } from '@/views/knowledge/lib/path.ts'
import type { LintIssue } from '@/views/knowledge/lib/wiki-lint.ts'

const LINT_CONFIG_KEY = 'knowledge.lint.config'

interface LintConfig {
  ignorePages: string[]
  semanticEnabled: boolean
}

const LINT_CONFIG_DEFAULTS: LintConfig = {
  ignorePages: [],
  semanticEnabled: false
}

function readLintConfig(): LintConfig {
  try {
    const raw = localStorage.getItem(LINT_CONFIG_KEY)
    if (!raw) return { ...LINT_CONFIG_DEFAULTS, ignorePages: [] }
    const parsed = JSON.parse(raw) as Partial<LintConfig>
    return {
      ignorePages: Array.isArray(parsed.ignorePages) ? parsed.ignorePages : [],
      semanticEnabled: Boolean(parsed.semanticEnabled)
    }
  } catch (error) {
    console.warn('[lint-config] read failed', error)
    return { ...LINT_CONFIG_DEFAULTS, ignorePages: [] }
  }
}

function writeLintConfig(config: LintConfig): void {
  try {
    localStorage.setItem(LINT_CONFIG_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('[lint-config] write failed', error)
  }
}

function filterLintIssues(issues: LintIssue[], config = readLintConfig()): LintIssue[] {
  const ignored = new Set(
    config.ignorePages.map(function (page) {
      return page.replace(/\\/g, '/').toLowerCase()
    })
  )
  return issues.filter(function (issue) {
    return !ignored.has(issue.page.replace(/\\/g, '/').toLowerCase())
  })
}

async function fixBrokenLinkStubs(input: {
  rootPath: string
  issues: LintIssue[]
}): Promise<number> {
  let created = 0
  const wikiDir = joinPath(input.rootPath, 'wiki')
  if (!(await exists(wikiDir))) {
    await mkdir(wikiDir, { recursive: true })
  }
  for (const issue of input.issues) {
    if (issue.kind !== 'broken-link') continue
    const match = issue.detail.match(/\[\[([^\]]+)\]\]/)
    const title = match?.[1]?.trim()
    if (!title) continue
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
      .slice(0, 48)
    const relative = `wiki/${slug || `stub-${Date.now()}`}.md`
    const absolute = joinPath(input.rootPath, relative)
    if (await exists(absolute)) continue
    const body = `---\ntitle: ${JSON.stringify(title)}\ntype: concept\n---\n\n# ${title}\n\n> stub：由 Lint 一键修复创建\n`
    await writeTextFile(absolute, body)
    created += 1
  }
  return created
}

export {
  LINT_CONFIG_DEFAULTS,
  filterLintIssues,
  fixBrokenLinkStubs,
  readLintConfig,
  writeLintConfig
}
export type { LintConfig }
