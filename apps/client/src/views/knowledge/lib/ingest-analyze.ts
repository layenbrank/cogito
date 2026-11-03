/**
 * Ingest 分析层：默认定性骨架；可注册 LLM 分析器（两步思维链入口）。
 */
import { readWikiOutputConfig } from '@/views/knowledge/lib/wiki-output-config.ts'
import type { ParsedFileBlock } from '@/views/knowledge/lib/ingest-file-blocks.ts'

interface IngestAnalysis {
  title: string
  summary: string
  tags: string[]
  /** 若提供则整页写入 wiki，否则由 runner 拼装 */
  wikiBody?: string
  /** ACP 多 FILE 块；优先于 wikiBody */
  fileBlocks?: ParsedFileBlock[]
  parseWarnings?: string[]
  needsReview: boolean
  /** 输出语言（来自 Wiki 设置 · 输出） */
  language: string
}

type IngestAnalyzer = (input: {
  relative: string
  markdown: string
  rootPath: string
  language: string
}) => Promise<IngestAnalysis>

let registeredAnalyzer: IngestAnalyzer | null = null

function registerIngestAnalyzer(analyzer: IngestAnalyzer | null): void {
  registeredAnalyzer = analyzer
}

function hasRegisteredIngestAnalyzer(): boolean {
  return registeredAnalyzer !== null
}

function fileStem(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '')
}

function analyzeDeterministic(
  relative: string,
  markdown: string,
  language: string
): IngestAnalysis {
  const titleMatch = markdown.match(/^#\s+(.+)$/m)
  const title = (titleMatch?.[1] ?? fileStem(relative)).trim()
  const plain = markdown
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/[#>*`[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const summary = plain.slice(0, 280) || title
  const tags = relative.includes('/')
    ? relative
        .split(/[/\\]/)
        .slice(0, -1)
        .filter(Boolean)
        .slice(-3)
    : []
  return {
    title,
    summary,
    tags,
    language,
    needsReview: markdown.trim().length < 40 || /请配置 MinerU|旁路/.test(markdown)
  }
}

async function analyzeForIngest(input: {
  relative: string
  markdown: string
  rootPath: string
}): Promise<IngestAnalysis> {
  const language = readWikiOutputConfig().language
  if (registeredAnalyzer) {
    try {
      return await registeredAnalyzer({ ...input, language })
    } catch (error) {
      console.error('[ingest-analyze] LLM analyzer failed; fallback deterministic', error)
    }
  }
  return analyzeDeterministic(input.relative, input.markdown, language)
}

export {
  analyzeDeterministic,
  analyzeForIngest,
  hasRegisteredIngestAnalyzer,
  registerIngestAnalyzer
}
export type { IngestAnalysis, IngestAnalyzer }
