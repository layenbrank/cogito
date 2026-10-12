/**
 * 能力工具：结构化产出的 prompt 构造与解析、代码编辑落盘
 */
import { findIsPathUnderRoots } from '@/features/agent/model/workspace-path'
import { FileIpc } from '@/lib/file-ipc'

import type {
  ComparePartData,
  DiffPart,
  MessagePart,
  PlanPartData
} from '@/features/agent/types'

/** 注入上下文的最大字符数，超出截断（防大文件撑爆上下文） */
const FILE_CONTEXT_LIMIT = 12000

const COMPARE_PROMPT = [
  '请对以下主题进行商品/方案对比分析：',
  '',
  '输出要求：只输出一个 JSON 代码块（```json 包裹），结构为：',
  '{"title": string, "attributes": ["对比维度1", ...], "items": [{"name": string, "price"?: string, "values": {"维度": "评价"}, "verdict"?: string}]}',
  '不要输出 JSON 之外的内容。信息可能过时，请基于公开常识。',
  '',
  '主题：'
].join('\n')

const PLAN_PROMPT = [
  '请为以下需求制定日常计划：',
  '',
  '输出要求：只输出一个 JSON 代码块（```json 包裹），结构为：',
  '{"date"?: "YYYY-MM-DD", "items": [{"time"?: "HH:mm", "title": string}]}',
  '不要输出 JSON 之外的内容。',
  '',
  '需求：'
].join('\n')

/** 从模型输出中提取指定类型的第一个 JSON 代码块 */
function parseStructured<T>(fragment: string): T | null {
  const match = fragment.match(/```json\s*([\s\S]*?)```/i) ?? fragment.match(/\{[\s\S]*\}/)
  const raw = match ? (match[1] ?? match[0]) : ''
  try {
    return JSON.parse(raw.trim()) as T
  } catch (error) {
    // 模型输出不是合法 JSON：这张结构化卡片直接不渲染，但别静默
    console.warn('[agent-parts] 结构化输出解析失败，跳过该部件:', error)
    return null
  }
}

function parseCompare(fragment: string): ComparePartData | null {
  const parsed = parseStructured<ComparePartData>(fragment)
  if (!parsed || !Array.isArray(parsed.items) || !Array.isArray(parsed.attributes)) return null
  return parsed
}

function parsePlan(fragment: string): PlanPartData | null {
  const parsed = parseStructured<PlanPartData>(fragment)
  if (!parsed || !Array.isArray(parsed.items)) return null
  return parsed
}

/** 提取模型输出中最后一个围栏代码块（代码编辑场景用于生成 Diff 部件） */
function extractLastCodeBlock(fragment: string): string | null {
  const matches = Array.from(fragment.matchAll(/```[^\n]*\n([\s\S]*?)```/g))
  const last = matches[matches.length - 1]
  return last ? (last[1] ?? null) : null
}

function parseParts(raw: string | null): MessagePart[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as MessagePart[]) : []
  } catch (error) {
    console.warn('[agent-parts] 消息部件存档损坏，回落空列表:', error)
    return []
  }
}

function stringifyParts(parts: MessagePart[]): string | null {
  return parts.length ? JSON.stringify(parts) : null
}

/** 代码编辑确认后落盘：整文件覆写 + 自动备份（须在工作区 roots 内） */
async function applyDiff(part: DiffPart, roots: string[]): Promise<void> {
  if (!findIsPathUnderRoots(part.data.path, roots)) {
    throw new Error('目标路径不在当前工作区，已拒绝写入')
  }
  await FileIpc.write(part.data.path, {
    content: part.data.after,
    mode: 'overwrite',
    backup: true
  })
}

export {
  FILE_CONTEXT_LIMIT,
  COMPARE_PROMPT,
  PLAN_PROMPT,
  parseCompare,
  parsePlan,
  extractLastCodeBlock,
  parseParts,
  stringifyParts,
  applyDiff
}
