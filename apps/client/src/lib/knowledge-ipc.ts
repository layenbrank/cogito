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
  KnowledgeDocSummarySchema,
  KnowledgeHitSchema,
  PublishedDocSchema,
  StagedFileSchema,
  type KnowledgeBase,
  type KnowledgeDocSummary,
  type KnowledgeHit,
  type PublishedDoc,
  type PublishMode,
  type StagedFile
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

export {
  createBase,
  discardStaged,
  listBases,
  listDocs,
  listStaging,
  publishDoc,
  removeDoc,
  rescanBase,
  searchDocs
}
export type { KnowledgeBase, KnowledgeDocSummary, KnowledgeHit, StagedFile }
