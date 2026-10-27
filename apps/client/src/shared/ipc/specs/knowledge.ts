/**
 * 知识库 IPC 契约（与 `cogito_core::knowledge` 的 serde camelCase 字段一一对应）。
 *
 * 注意 `knowledge_doc.content` 只在发布返回里出现；列表走摘要，避免整篇正文过 IPC。
 */
import { z } from 'zod'

const KnowledgeBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullish(),
  scope: z.string(),
  tenantId: z.string().nullish(),
  rootPath: z.string(),
  autoUpdate: z.boolean(),
  autoExport: z.boolean(),
  citation: z.boolean(),
  cloudModel: z.string().nullish(),
  cloudDimensions: z.number().nullish(),
  archivedAt: z.number().nullish(),
  createdAt: z.number(),
  updatedAt: z.number()
})

const KnowledgeDocSummarySchema = z.object({
  id: z.string(),
  baseId: z.string(),
  title: z.string(),
  relPath: z.string(),
  wordCount: z.number(),
  revision: z.number(),
  status: z.string(),
  source: z.string(),
  updatedAt: z.number()
})

const KnowledgeHitSchema = z.object({
  docId: z.string(),
  baseId: z.string(),
  title: z.string(),
  relPath: z.string(),
  snippet: z.string(),
  score: z.number(),
  /** fts（BM25）或 like（1–2 字短词回退） */
  mode: z.string()
})

const StagedFileSchema = z.object({
  baseId: z.string(),
  path: z.string(),
  name: z.string(),
  session: z.string(),
  size: z.number(),
  modifiedAt: z.number()
})

/** 发布返回的是整行 `knowledge_doc`，界面只用得到这几个字段 */
const PublishedDocSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  title: z.string(),
  relPath: z.string(),
  status: z.string(),
  revision: z.number()
})

const PublishModeSchema = z.enum(['replace', 'keepboth'])

const SearchInputSchema = z.object({
  query: z.string().min(1),
  baseId: z.string().optional(),
  topK: z.number().int().positive().max(20).optional()
})

type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>
type KnowledgeDocSummary = z.infer<typeof KnowledgeDocSummarySchema>
type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>
type StagedFile = z.infer<typeof StagedFileSchema>
type PublishedDoc = z.infer<typeof PublishedDocSchema>
type PublishMode = z.infer<typeof PublishModeSchema>

export {
  KnowledgeBaseSchema,
  KnowledgeDocSummarySchema,
  KnowledgeHitSchema,
  PublishModeSchema,
  PublishedDocSchema,
  SearchInputSchema,
  StagedFileSchema
}
export type {
  KnowledgeBase,
  KnowledgeDocSummary,
  KnowledgeHit,
  PublishedDoc,
  PublishMode,
  StagedFile
}
