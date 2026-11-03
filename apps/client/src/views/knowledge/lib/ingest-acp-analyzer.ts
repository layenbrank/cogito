/**
 * ACP 两阶段 Ingest Analyzer：分析 → 生成 FILE 块。
 * 经 runInlinePrompt；失败由调用方回退确定性分析。
 */
import { exists, readTextFile } from '@tauri-apps/plugin-fs'

import { runInlinePrompt } from '@/features/agent/inline-prompt'
import { buildModelPort } from '@/features/agent/port/model'
import type { IngestAnalysis, IngestAnalyzer } from '@/views/knowledge/lib/ingest-analyze.ts'
import { parseFileBlocks } from '@/views/knowledge/lib/ingest-file-blocks.ts'
import { joinPath } from '@/views/knowledge/lib/path.ts'

const INGEST_THREAD_HINT = 'knowledge-ingest'
const SOURCE_BUDGET = 24_000

async function readProjectDoc(rootPath: string, relative: string): Promise<string> {
  const absolute = joinPath(rootPath, relative)
  try {
    if (!(await exists(absolute))) return ''
    return (await readTextFile(absolute)).slice(0, 6_000)
  } catch (error) {
    console.warn('[ingest-acp] read project doc failed', relative, error)
    return ''
  }
}

function parseTitleFromBody(body: string, fallback: string): string {
  const fm = body.match(/^---\s*\n([\s\S]*?)\n---/)
  if (fm?.[1]) {
    const titleLine = fm[1].match(/^title:\s*(.+)$/m)
    if (titleLine?.[1]) {
      return titleLine[1].replace(/^["']|["']$/g, '').trim() || fallback
    }
  }
  const heading = body.match(/^#\s+(.+)$/m)
  return (heading?.[1] ?? fallback).trim()
}

function buildAnalysisPrompt(input: {
  relative: string
  markdown: string
  language: string
  schema: string
  purpose: string
}): string {
  return [
    `你是知识库 ingest 分析器。输出语言：${input.language}。`,
    '只输出简短 Markdown：第一行 `# 标题`，随后一段摘要（≤200字），可选一行 `tags: a, b`。',
    '不要写 FILE 块，不要调用工具。',
    '',
    '## purpose.md',
    input.purpose || '(空)',
    '',
    '## schema.md',
    input.schema || '(空)',
    '',
    `## 来源 ${input.relative}`,
    input.markdown.slice(0, SOURCE_BUDGET)
  ].join('\n')
}

function buildGenerationPrompt(input: {
  relative: string
  markdown: string
  language: string
  schema: string
  purpose: string
  analysis: string
}): string {
  const slugHint = input.relative
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .slice(0, 40)
  return [
    `你是知识库 wiki 页生成器。输出语言：${input.language}。`,
    '只输出一个或多个 FILE 块，禁止解释性前后文。',
    '格式：',
    '---FILE: wiki/<slug>.md---',
    '---',
    'title: "标题"',
    'type: concept',
    `sources: ["${input.relative.replace(/\\/g, '/')}"]`,
    '---',
    '',
    '# 标题',
    '正文…',
    '---END FILE---',
    '',
    '规则：',
    '- 路径必须在 wiki/ 下；禁止生成 wiki/index.md、wiki/log.md、wiki/overview.md。',
    '- frontmatter 必填 type 与 sources。',
    `- 建议路径 wiki/${slugHint || 'page'}.md（可按类型微调）。`,
    '- 不要调用工具。',
    '',
    '## purpose.md',
    input.purpose || '(空)',
    '',
    '## schema.md',
    input.schema || '(空)',
    '',
    '## 分析结果',
    input.analysis,
    '',
    `## 来源 ${input.relative}`,
    input.markdown.slice(0, SOURCE_BUDGET)
  ].join('\n')
}

async function isAcpIngestReady(): Promise<boolean> {
  try {
    const target = await buildModelPort().findTarget()
    return Boolean(target)
  } catch (error) {
    console.warn('[ingest-acp] readiness check failed', error)
    return false
  }
}

const analyzeWithAcp: IngestAnalyzer = async function (input) {
  const [schema, purpose] = await Promise.all([
    readProjectDoc(input.rootPath, 'schema.md'),
    readProjectDoc(input.rootPath, 'purpose.md')
  ])

  const analysisText = await runInlinePrompt({
    text: buildAnalysisPrompt({
      relative: input.relative,
      markdown: input.markdown,
      language: input.language,
      schema,
      purpose
    }),
    systemText: `你是 ${INGEST_THREAD_HINT} 分析阶段。只输出标题与摘要，不要工具调用。`
  })

  const generation = await runInlinePrompt({
    text: buildGenerationPrompt({
      relative: input.relative,
      markdown: input.markdown,
      language: input.language,
      schema,
      purpose,
      analysis: analysisText
    }),
    systemText: `你是 ${INGEST_THREAD_HINT} 生成阶段。只输出 ---FILE:--- 块，不要工具调用。`
  })

  const parsed = parseFileBlocks(generation)
  if (parsed.blocks.length === 0) {
    throw new Error(
      parsed.warnings[0] || 'ACP 未产出有效 FILE 块'
    )
  }

  const primary = parsed.blocks[0]!
  const title = parseTitleFromBody(primary.content, input.relative)
  const summary = analysisText
    .replace(/^#\s+.+$/m, '')
    .replace(/^tags:.*$/im, '')
    .trim()
    .slice(0, 280)

  const tagsMatch = analysisText.match(/^tags:\s*(.+)$/im)
  const tags = tagsMatch?.[1]
    ? tagsMatch[1]
        .split(/[,，]/)
        .map(function (tag) {
          return tag.trim()
        })
        .filter(Boolean)
        .slice(0, 8)
    : []

  const result: IngestAnalysis = {
    title,
    summary: summary || title,
    tags,
    language: input.language,
    needsReview: parsed.warnings.length > 0 || primary.content.trim().length < 80,
    wikiBody: primary.content,
    fileBlocks: parsed.blocks,
    parseWarnings: parsed.warnings
  }
  return result
}

export { analyzeWithAcp, isAcpIngestReady }
