/**
 * 从线程工具调用里抽出文件路径（产出清单 / 审阅入口）。
 *
 * 路径在 goose `rawInput` → tool-call `args` 里，键名不统一；
 * 这里只认常见字段，并尽量压成工作区相对路径。
 */
import type { ThreadMessage } from '@assistant-ui/react'

import { findWorkspaceRelative } from '@/features/agent/workspace/paths.ts'

interface ToolPathHit {
  path: string
  toolName: string
}

const PATH_KEYS = ['filePath', 'path', 'file', 'target', 'filename'] as const

/** 改文件工具：比审批用的 isWriteTool 窄，排除 shell / memory 等 */
function isFileMutationTool(name: string) {
  const lower = name.toLowerCase()
  if (lower.includes('shell') || lower.includes('bash') || lower.includes('terminal')) return false
  if (lower.includes('memory') || lower.includes('web_')) return false
  return (
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('str_replace') ||
    lower.includes('text_editor') ||
    lower.includes('apply_diff') ||
    lower.includes('create_file') ||
    lower.includes('delete_file') ||
    lower.includes('remove_file') ||
    lower.includes('rename_file') ||
    (lower.includes('patch') && !lower.includes('dispatch'))
  )
}

function findArgPath(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const record = args as Record<string, unknown>
  for (const key of PATH_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/** 绝对路径压成相对；已是相对则只统一斜杠 */
function normalizeToolPath(raw: string, rootPath: string | null): string | null {
  const normalized = raw.replace(/\\/g, '/')
  if (!normalized || normalized === '.' || normalized.endsWith('/')) return null

  if (rootPath && (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized))) {
    const relative = findWorkspaceRelative(normalized, rootPath)
    if (!relative || relative === '.') return null
    return relative
  }

  return normalized.replace(/^\.\//, '')
}

/**
 * 收集本会话改文件工具触及的路径（去重，保留首次出现顺序）。
 */
function collectToolPaths(
  messages: readonly ThreadMessage[],
  rootPath: string | null
): ToolPathHit[] {
  const hits: ToolPathHit[] = []
  const seen = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue
      if (!isFileMutationTool(part.toolName)) continue
      const raw = findArgPath(part.args)
      if (!raw) continue
      const path = normalizeToolPath(raw, rootPath)
      if (!path || seen.has(path)) continue
      seen.add(path)
      hits.push({ path, toolName: part.toolName })
    }
  }

  return hits
}

export { collectToolPaths, findArgPath, isFileMutationTool, normalizeToolPath }
export type { ToolPathHit }
