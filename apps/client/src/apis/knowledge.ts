/**
 * 知识库 IPC（列表 / 检索 / staging 发布）。
 *
 * 写入分两层：agent 的 `cogito_knowledge_write_doc` 只写 staging（待发布区），
 * 正文发布（`knowledge:publish`）只由用户在这里确认后触发。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  KnowledgeSpaceSchema,
  KnowledgeDocRefSchema,
  KnowledgeDocSummarySchema,
  KnowledgeHitSchema,
  MigrationReportSchema,
  PublishedDocSchema,
  StagedDocSchema,
  StagedFileSchema,
  WikiContractSchema,
  WriteDocOutcomeSchema,
  type KnowledgeSpace,
  type KnowledgeDocRef,
  type KnowledgeDocSummary,
  type KnowledgeHit,
  type MigrationReport,
  type PublishedDoc,
  type PublishMode,
  type StagedDoc,
  type StagedFile,
  type WikiContract,
  type WriteDocOutcome
} from '@/shared/ipc/specs/knowledge'

function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

async function GET_KNOWLEDGE_SPACES(): Promise<KnowledgeSpace[]> {
  try {
    return KnowledgeSpaceSchema.array().parse(await invoke(CHANNELS.KNOWLEDGE.LIST_SPACES))
  } catch (error) {
    throw asError(error, '读取知识库失败')
  }
}

async function POST_KNOWLEDGE_SPACE(name: string): Promise<KnowledgeSpace> {
  try {
    return KnowledgeSpaceSchema.parse(await invoke(CHANNELS.KNOWLEDGE.CREATE_SPACE, { name }))
  } catch (error) {
    throw asError(error, '新建知识库失败')
  }
}

async function GET_KNOWLEDGE_DOCS(spaceId?: string): Promise<KnowledgeDocSummary[]> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.LIST_DOCS, { spaceId })
    return KnowledgeDocSummarySchema.array().parse(raw ?? [])
  } catch (error) {
    throw asError(error, '读取文档列表失败')
  }
}

async function GET_KNOWLEDGE_SEARCH(query: string, spaceId?: string, topK?: number): Promise<KnowledgeHit[]> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.SEARCH, { query, spaceId, topK })
    return KnowledgeHitSchema.array().parse(raw ?? [])
  } catch (error) {
    throw asError(error, '检索失败')
  }
}

async function GET_KNOWLEDGE_STAGING(spaceId?: string): Promise<StagedFile[]> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.LIST_STAGING, { spaceId })
    return StagedFileSchema.array().parse(raw ?? [])
  } catch (error) {
    throw asError(error, '读取待发布草稿失败')
  }
}

async function POST_KNOWLEDGE_PUBLISH(spaceId: string, path: string, mode: PublishMode): Promise<PublishedDoc> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.PUBLISH, { spaceId, path, mode })
    return PublishedDocSchema.parse(raw)
  } catch (error) {
    throw asError(error, '发布失败')
  }
}

/** 批量发布：多章各自成页，索引只重建一次 */
async function POST_KNOWLEDGE_PUBLISH_MANY(
  spaceId: string,
  paths: string[],
  mode: PublishMode
): Promise<KnowledgeDocSummary[]> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.PUBLISH_MANY, { spaceId, paths, mode })
    return KnowledgeDocSummarySchema.array().parse(raw ?? [])
  } catch (error) {
    throw asError(error, '批量发布失败')
  }
}

/** 存量归位：库根 / 错目录的页面挪进 wiki/<type>/；dryRun 只出报告 */
async function POST_KNOWLEDGE_MIGRATE_LAYOUT(
  spaceId: string,
  dryRun = true
): Promise<MigrationReport> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.MIGRATE_LAYOUT, { spaceId, dryRun })
    return MigrationReportSchema.parse(raw)
  } catch (error) {
    throw asError(error, '归位存量文档失败')
  }
}

/** 按库内文档重建 wiki/index.md */
async function POST_KNOWLEDGE_REBUILD_INDEX(spaceId: string): Promise<number> {
  try {
    return await invoke<number>(CHANNELS.KNOWLEDGE.REBUILD_INDEX, { spaceId })
  } catch (error) {
    throw asError(error, '重建索引失败')
  }
}

/** wiki 规范契约（类型 → 目录、必填 frontmatter）：不要在别处再维护一份 */
async function GET_KNOWLEDGE_WIKI_CONTRACT(): Promise<WikiContract> {
  try {
    return WikiContractSchema.parse(await invoke(CHANNELS.KNOWLEDGE.WIKI_CONTRACT))
  } catch (error) {
    throw asError(error, '读取知识库规范失败')
  }
}

/** 合并分章（确定性拼接）：结果仍是 staging 草稿，发布要用户确认 */
async function POST_KNOWLEDGE_MERGE(spaceId: string, paths: string[], title: string): Promise<StagedDoc> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.MERGE_STAGING, { spaceId, paths, title })
    return StagedDocSchema.parse(raw)
  } catch (error) {
    throw asError(error, '合并草稿失败')
  }
}

async function DELETE_KNOWLEDGE_STAGING(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>(CHANNELS.KNOWLEDGE.DISCARD_STAGING, { path })
  } catch (error) {
    throw asError(error, '丢弃草稿失败')
  }
}

async function POST_KNOWLEDGE_RESCAN(spaceId: string): Promise<number> {
  try {
    return await invoke<number>(CHANNELS.KNOWLEDGE.RESCAN, { spaceId })
  } catch (error) {
    throw asError(error, '重新扫描失败')
  }
}

async function DELETE_KNOWLEDGE_DOC(id: string): Promise<number> {
  try {
    return await invoke<number>(CHANNELS.KNOWLEDGE.REMOVE_DOC, { id })
  } catch (error) {
    throw asError(error, '删除文档失败')
  }
}

/** 取文档引用（库内 hash）；不在任何知识库里时 `matched=false` */
async function GET_KNOWLEDGE_DOC_REF(path: string): Promise<KnowledgeDocRef> {
  try {
    return KnowledgeDocRefSchema.parse(await invoke(CHANNELS.KNOWLEDGE.RESOLVE_DOC, { path }))
  } catch (error) {
    throw asError(error, '读取文档信息失败')
  }
}

/**
 * 保存文档：写正式文件 + 落库。
 *
 * - `matched=false`：不在知识库里，调用方自己写普通文件；
 * - `conflict=true`：期间库内被别处改过，**没有写盘**，等用户选「保留我的 / 重载」；
 * - `force=true`：用户已选择保留我的，直接覆盖。
 */
async function PUT_KNOWLEDGE_DOC(input: {
  path: string
  content: string
  expectedHash?: string | null
  force?: boolean
}): Promise<WriteDocOutcome> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.WRITE_DOC, {
      path: input.path,
      content: input.content,
      expectedHash: input.expectedHash ?? null,
      force: input.force ?? false
    })
    return WriteDocOutcomeSchema.parse(raw)
  } catch (error) {
    throw asError(error, '保存文档失败')
  }
}

// 整包导出：把库里的 Markdown 打成 zip（后端写在 <库目录>/exports/），返回绝对路径
async function POST_KNOWLEDGE_EXPORT(spaceId: string): Promise<string> {
  try {
    return await invoke<string>(CHANNELS.KNOWLEDGE.EXPORT_BUNDLE, { spaceId })
  } catch (error) {
    throw asError(error, '导出知识库失败')
  }
}

interface PdfExtractResult {
  path: string
  pageCount: number
  markdown: string
  imagePaths: string[]
}

async function POST_KNOWLEDGE_PDF(
  path: string,
  options: { mediaDir?: string; extractImages?: boolean } = {}
): Promise<PdfExtractResult> {
  try {
    return await invoke<PdfExtractResult>(CHANNELS.KNOWLEDGE.EXTRACT_PDF, {
      path,
      mediaDir: options.mediaDir ?? null,
      extractImages: options.extractImages
    })
  } catch (error) {
    throw asError(error, 'PDF 抽取失败')
  }
}

async function GET_KNOWLEDGE_PDFIUM(): Promise<string | null> {
  try {
    return (await invoke<string | null>(CHANNELS.KNOWLEDGE.FIND_PDFIUM)) ?? null
  } catch (error) {
    console.warn('[knowledge] findPdfium failed', error)
    return null
  }
}

export {
  POST_KNOWLEDGE_SPACE,
  DELETE_KNOWLEDGE_STAGING,
  POST_KNOWLEDGE_EXPORT,
  POST_KNOWLEDGE_PDF,
  GET_KNOWLEDGE_PDFIUM,
  GET_KNOWLEDGE_SPACES,
  GET_KNOWLEDGE_DOCS,
  GET_KNOWLEDGE_STAGING,
  GET_KNOWLEDGE_WIKI_CONTRACT,
  POST_KNOWLEDGE_MERGE,
  POST_KNOWLEDGE_MIGRATE_LAYOUT,
  POST_KNOWLEDGE_PUBLISH,
  POST_KNOWLEDGE_PUBLISH_MANY,
  POST_KNOWLEDGE_REBUILD_INDEX,
  DELETE_KNOWLEDGE_DOC,
  POST_KNOWLEDGE_RESCAN,
  GET_KNOWLEDGE_DOC_REF,
  GET_KNOWLEDGE_SEARCH,
  PUT_KNOWLEDGE_DOC
}
export type { PdfExtractResult }
export type {
  KnowledgeSpace,
  KnowledgeDocSummary,
  KnowledgeHit,
  MigrationReport,
  StagedFile,
  WikiContract
}
