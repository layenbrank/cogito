/**
 * 知识库 IPC（列表 / 检索 / staging 发布）。
 *
 * 写正文（发布）只在这里发生：agent 的 `app_knowledge_write_doc` 只写 staging，
 * 用户在这里点确认才落到正式目录与数据库。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  KnowledgeBaseSchema,
  KnowledgeDocRefSchema,
  KnowledgeDocSummarySchema,
  KnowledgeHitSchema,
  PublishedDocSchema,
  StagedDocSchema,
  StagedFileSchema,
  WriteDocOutcomeSchema,
  type KnowledgeBase,
  type KnowledgeDocRef,
  type KnowledgeDocSummary,
  type KnowledgeHit,
  type PublishedDoc,
  type PublishMode,
  type StagedDoc,
  type StagedFile,
  type WriteDocOutcome
} from '@/shared/ipc/specs/knowledge'

function asError(error: unknown, label: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`${label}: ${String(error)}`)
}

async function listBases(): Promise<KnowledgeBase[]> {
  try {
    return KnowledgeBaseSchema.array().parse(await invoke(CHANNELS.KNOWLEDGE.LIST_BASES))
  } catch (error) {
    throw asError(error, '读取知识库失败')
  }
}

async function createBase(name: string): Promise<KnowledgeBase> {
  try {
    return KnowledgeBaseSchema.parse(await invoke(CHANNELS.KNOWLEDGE.CREATE_BASE, { name }))
  } catch (error) {
    throw asError(error, '新建知识库失败')
  }
}

async function listDocs(baseId?: string): Promise<KnowledgeDocSummary[]> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.LIST_DOCS, { baseId })
    return KnowledgeDocSummarySchema.array().parse(raw ?? [])
  } catch (error) {
    throw asError(error, '读取文档列表失败')
  }
}

async function searchDocs(
  query: string,
  baseId?: string,
  topK?: number
): Promise<KnowledgeHit[]> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.SEARCH, { query, baseId, topK })
    return KnowledgeHitSchema.array().parse(raw ?? [])
  } catch (error) {
    throw asError(error, '检索失败')
  }
}

async function listStaging(baseId?: string): Promise<StagedFile[]> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.LIST_STAGING, { baseId })
    return StagedFileSchema.array().parse(raw ?? [])
  } catch (error) {
    throw asError(error, '读取待发布草稿失败')
  }
}

async function publishDoc(
  baseId: string,
  path: string,
  mode: PublishMode
): Promise<PublishedDoc> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.PUBLISH, { baseId, path, mode })
    return PublishedDocSchema.parse(raw)
  } catch (error) {
    throw asError(error, '发布失败')
  }
}

/** 合并分章（确定性拼接）：结果仍是 staging 草稿，发布要用户确认 */
async function mergeStaging(baseId: string, paths: string[], title: string): Promise<StagedDoc> {
  try {
    const raw = await invoke(CHANNELS.KNOWLEDGE.MERGE_STAGING, { baseId, paths, title })
    return StagedDocSchema.parse(raw)
  } catch (error) {
    throw asError(error, '合并草稿失败')
  }
}

async function discardStaged(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>(CHANNELS.KNOWLEDGE.DISCARD_STAGING, { path })
  } catch (error) {
    throw asError(error, '丢弃草稿失败')
  }
}

async function rescanBase(baseId: string): Promise<number> {
  try {
    return await invoke<number>(CHANNELS.KNOWLEDGE.RESCAN, { baseId })
  } catch (error) {
    throw asError(error, '重新扫描失败')
  }
}

async function removeDoc(id: string): Promise<number> {
  try {
    return await invoke<number>(CHANNELS.KNOWLEDGE.REMOVE_DOC, { id })
  } catch (error) {
    throw asError(error, '删除文档失败')
  }
}

/** 取文档引用（库内 hash）；不在任何知识库里时 `matched=false` */
async function resolveDoc(path: string): Promise<KnowledgeDocRef> {
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
async function writeDoc(input: {
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

export {
  createBase,
  discardStaged,
  listBases,
  listDocs,
  listStaging,
  mergeStaging,
  publishDoc,
  removeDoc,
  rescanBase,
  resolveDoc,
  searchDocs,
  writeDoc
}
export type { KnowledgeBase, KnowledgeDocSummary, KnowledgeHit, StagedFile }
