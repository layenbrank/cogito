/**
 * 知识库 IPC 契约（与 `cogito_core::knowledge` 的 serde camelCase 字段一一对应）。
 *
 * 注意 `knowledge_doc.content` 只在发布返回里出现；列表走摘要，避免整篇正文过 IPC。
 */
import { z } from 'zod'

const KnowledgeSpaceSchema = z.object({
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
  spaceId: z.string(),
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
  spaceId: z.string(),
  title: z.string(),
  relPath: z.string(),
  snippet: z.string(),
  score: z.number(),
  /** fts（BM25）或 like（1–2 字短词回退） */
  mode: z.string()
})

const StagedFileSchema = z.object({
  spaceId: z.string(),
  path: z.string(),
  name: z.string(),
  session: z.string(),
  size: z.number(),
  modifiedAt: z.number(),
  /** frontmatter 里的标题（没写就是空） */
  title: z.string().nullish(),
  /** frontmatter 里的页面类型 */
  pageType: z.string().nullish(),
  /** 发布后的目标相对路径（按 type 推导） */
  relPath: z.string().nullish()
})

/** 发布返回的是整行 `knowledge_doc`，界面只用得到这几个字段 */
const PublishedDocSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  title: z.string(),
  relPath: z.string(),
  status: z.string(),
  revision: z.number()
})

/** 合并后的 staging 草稿（仍是草稿，发布要用户点） */
const StagedDocSchema = z.object({
  spaceId: z.string(),
  path: z.string(),
  title: z.string(),
  slug: z.string(),
  pageType: z.string(),
  relPath: z.string()
})

/** 归位计划里的一条搬迁 */
const PageMoveSchema = z.object({
  from: z.string(),
  to: z.string(),
  pageType: z.string(),
  title: z.string()
})

/** 存量归位报告：dryRun 只列计划，不动磁盘 */
const MigrationReportSchema = z.object({
  dryRun: z.boolean(),
  moves: PageMoveSchema.array(),
  skipped: z.object({ path: z.string(), reason: z.string() }).array()
})

/** wiki 规范契约：类型 → 目录与必填 frontmatter（Rust 单一源） */
const WikiContractSchema = z.object({
  types: z
    .object({ name: z.string(), dir: z.string(), label: z.string() })
    .array(),
  defaultType: z.string(),
  requiredFrontMatter: z.string().array(),
  aggregatePaths: z.string().array(),
  naming: z.string()
})

/** 有云端索引的文档：docID ↔ 云端 assetID（两路召回靠它对回去重） */
const CloudDocSchema = z.object({
  docId: z.string(),
  assetId: z.string()
})

/** 一篇文档的云端索引状态；没有行就是 idle */
const CloudStateSchema = z.object({
  docId: z.string(),
  status: z.string(),
  assetId: z.string().nullish(),
  indexedAt: z.number().nullish(),
  error: z.string().nullish()
})

const PublishModeSchema = z.enum(['replace', 'keepboth'])

/** 文档引用：打开时取一次，保存时把 `hash` 带回去做冲突判定 */
const KnowledgeDocRefSchema = z.object({
  matched: z.boolean(),
  docId: z.string().nullish(),
  spaceId: z.string().nullish(),
  relPath: z.string().nullish(),
  hash: z.string().nullish(),
  revision: z.number().nullish()
})

/** 保存结果：`matched=false` 表示不在任何库里（按普通文件自己写） */
const WriteDocOutcomeSchema = z.object({
  matched: z.boolean(),
  conflict: z.boolean(),
  doc: KnowledgeDocSummarySchema.nullish(),
  hash: z.string().nullish(),
  revision: z.number().nullish()
})

const SearchInputSchema = z.object({
  query: z.string().min(1),
  spaceId: z.string().optional(),
  topK: z.number().int().positive().max(20).optional()
})

type KnowledgeSpace = z.infer<typeof KnowledgeSpaceSchema>
type KnowledgeDocRef = z.infer<typeof KnowledgeDocRefSchema>
type KnowledgeDocSummary = z.infer<typeof KnowledgeDocSummarySchema>
type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>
type StagedFile = z.infer<typeof StagedFileSchema>
type CloudDoc = z.infer<typeof CloudDocSchema>
type CloudState = z.infer<typeof CloudStateSchema>
type StagedDoc = z.infer<typeof StagedDocSchema>
type PublishedDoc = z.infer<typeof PublishedDocSchema>
type PublishMode = z.infer<typeof PublishModeSchema>
type WriteDocOutcome = z.infer<typeof WriteDocOutcomeSchema>
type PageMove = z.infer<typeof PageMoveSchema>
type MigrationReport = z.infer<typeof MigrationReportSchema>
type WikiContract = z.infer<typeof WikiContractSchema>

export {
  CloudDocSchema,
  CloudStateSchema,
  KnowledgeSpaceSchema,
  KnowledgeDocRefSchema,
  KnowledgeDocSummarySchema,
  KnowledgeHitSchema,
  MigrationReportSchema,
  PageMoveSchema,
  PublishedDocSchema,
  PublishModeSchema,
  SearchInputSchema,
  StagedDocSchema,
  StagedFileSchema,
  WikiContractSchema,
  WriteDocOutcomeSchema
}
export type {
  CloudDoc,
  CloudState,
  KnowledgeSpace,
  KnowledgeDocRef,
  KnowledgeDocSummary,
  KnowledgeHit,
  MigrationReport,
  PageMove,
  PublishedDoc,
  PublishMode,
  StagedDoc,
  StagedFile,
  WikiContract,
  WriteDocOutcome
}
