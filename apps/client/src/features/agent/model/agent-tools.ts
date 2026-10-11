/**
 * Agent 本地 tools：定义 + 工作区约束下的执行
 */
import { FILE_CONTEXT_LIMIT } from '@/features/agent/model/tools'
import { findIsPathUnderRoots, normalizePath } from '@/features/agent/model/workspace-path'
import type { AgentToolDefinition, ToolCallRequest, ToolCallResult } from '@/features/agent/types'
import { WorkspaceFiles } from '@/lib/workspace-files'
import { WorkspaceSkills } from '@/lib/workspace-skills'

const TOOL_READ_FILE = 'read_file'
const TOOL_LIST_DIR = 'list_dir'
const TOOL_SEARCH_FILES = 'search_files'
const TOOL_READ_SKILL = 'read_skill'

interface AgentToolContext {
  roots: string[]
}

function truncateContent(content: string) {
  if (content.length <= FILE_CONTEXT_LIMIT) return content
  return content.slice(0, FILE_CONTEXT_LIMIT) + '\n…（内容过长，已截断）'
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

function findStringArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

function findNumberArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: TOOL_READ_FILE,
      description: '读取工作区内某个文件的文本内容。用户用 @path 引用的文件应优先调用本工具。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '绝对路径，或相对某个 workspace root 的路径'
          },
          offset: {
            type: 'integer',
            description: '可选，从第几行开始（1-based）'
          },
          limit: {
            type: 'integer',
            description: '可选，最多读取多少行'
          }
        },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: TOOL_LIST_DIR,
      description: '列举工作区目录下的文件与子目录（单层）。',
      parameters: {
        type: 'object',
        properties: {
          root: {
            type: 'string',
            description: 'workspace root 绝对路径；省略则用第一个 root'
          },
          relative: {
            type: 'string',
            description: '相对 root 的子路径，默认为空'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: TOOL_SEARCH_FILES,
      description: '在工作区中按文件名关键字搜索文件（最多 50 条）。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键字'
          },
          limit: {
            type: 'integer',
            description: '返回条数上限，默认 50'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: TOOL_READ_SKILL,
      description:
        '读取工作区内某个 Agent Skill（SKILL.md）。用户用 /skillName 引用时应优先调用本工具。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '技能名称（frontmatter name）'
          },
          path: {
            type: 'string',
            description: '可选，技能文件绝对路径'
          }
        },
        additionalProperties: false
      }
    }
  }
]

async function resolvePathUnderRoots(pathOrRelative: string, roots: string[]) {
  const normalized = normalizePath(pathOrRelative)
  if (!normalized) throw new Error('path 不能为空')
  if (findIsPathUnderRoots(normalized, roots)) return normalized

  for (const root of roots) {
    const candidate = normalizePath(`${root}/${normalized.replace(/^\.\//, '')}`)
    if (findIsPathUnderRoots(candidate, roots)) return candidate
  }
  throw new Error(`路径不在工作区内：${pathOrRelative}`)
}

async function executeReadFile(args: Record<string, unknown>, context: AgentToolContext) {
  if (!context.roots.length) throw new Error('未配置工作区文件夹')
  const path = await resolvePathUnderRoots(findStringArg(args, 'path'), context.roots)
  const { content } = await WorkspaceFiles.readFile(context.roots, path)
  const offset = findNumberArg(args, 'offset')
  const limit = findNumberArg(args, 'limit')
  if (offset !== undefined || limit !== undefined) {
    const lines = content.split('\n')
    const start = Math.max(0, (offset ?? 1) - 1)
    const end = limit !== undefined ? start + Math.max(0, limit) : lines.length
    return truncateContent(lines.slice(start, end).join('\n'))
  }
  return truncateContent(content)
}

async function executeListDir(args: Record<string, unknown>, context: AgentToolContext) {
  if (!context.roots.length) throw new Error('未配置工作区文件夹')
  const rootArg = findStringArg(args, 'root')
  const root = rootArg
    ? await resolvePathUnderRoots(rootArg, context.roots)
    : normalizePath(context.roots[0])
  const relative = findStringArg(args, 'relative')
  const entries = await WorkspaceFiles.listDir(root, relative)
  return JSON.stringify(
    entries.map(function (item) {
      return {
        name: item.name,
        kind: item.kind,
        path: normalizePath(item.path),
        relative: normalizePath(item.relative)
      }
    }),
    null,
    2
  )
}

async function executeSearchFiles(args: Record<string, unknown>, context: AgentToolContext) {
  if (!context.roots.length) throw new Error('未配置工作区文件夹')
  const query = findStringArg(args, 'query')
  const limit = findNumberArg(args, 'limit') ?? 50
  const hits = await WorkspaceFiles.search(context.roots, query, limit)
  return JSON.stringify(
    hits.map(function (hit) {
      return {
        name: hit.name,
        path: normalizePath(hit.path),
        relative: normalizePath(hit.relative)
      }
    }),
    null,
    2
  )
}

async function executeReadSkill(args: Record<string, unknown>, context: AgentToolContext) {
  if (!context.roots.length) throw new Error('未配置工作区文件夹')
  const name = findStringArg(args, 'name')
  const pathArg = findStringArg(args, 'path')
  const skills = await WorkspaceSkills.fetchSkills(context.roots)

  let skill = pathArg
    ? skills.find(function (item) {
        return normalizePath(item.path) === normalizePath(pathArg)
      })
    : undefined
  if (!skill && name) {
    skill = skills.find(function (item) {
      return item.name.toLowerCase() === name.toLowerCase()
    })
  }
  if (!skill) {
    throw new Error(name || pathArg ? `未找到技能：${name || pathArg}` : '请提供 name 或 path')
  }

  const path = await resolvePathUnderRoots(skill.path, context.roots)
  const { content: raw } = await WorkspaceFiles.readFile(context.roots, path)
  const content = truncateContent(raw)
  return [
    `# Skill: ${skill.name}`,
    skill.description ? `说明：${skill.description}` : '',
    '',
    content
  ]
    .filter(Boolean)
    .join('\n')
}

async function executeAgentTool(
  request: ToolCallRequest,
  context: AgentToolContext
): Promise<ToolCallResult> {
  const args = parseToolArgs(request.arguments)
  try {
    let content = ''
    if (request.name === TOOL_READ_FILE) content = await executeReadFile(args, context)
    else if (request.name === TOOL_LIST_DIR) content = await executeListDir(args, context)
    else if (request.name === TOOL_SEARCH_FILES) content = await executeSearchFiles(args, context)
    else if (request.name === TOOL_READ_SKILL) content = await executeReadSkill(args, context)
    else throw new Error(`未知工具：${request.name}`)

    return {
      toolCallId: request.id,
      name: request.name,
      content
    }
  } catch (error) {
    return {
      toolCallId: request.id,
      name: request.name,
      content: error instanceof Error ? error.message : String(error),
      isError: true
    }
  }
}

/**
 * 对齐 Desktop appendDroppedFilePaths：把绝对路径拼进 user 文本，不内联内容。
 * 已出现在原文中的路径不再重复追加。
 */
function appendAttachedPaths(text: string, paths: string[]): string {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    const path = normalizePath(raw)
    if (!path) continue
    if (seen.has(path)) continue
    if (text.includes(path)) continue
    seen.add(path)
    unique.push(path)
  }
  if (!unique.length) return text
  const pathsString = unique.join(' ')
  return text.trim() ? `${text.trim()} ${pathsString}` : pathsString
}

export {
  AGENT_TOOL_DEFINITIONS,
  TOOL_LIST_DIR,
  TOOL_READ_FILE,
  TOOL_READ_SKILL,
  TOOL_SEARCH_FILES,
  appendAttachedPaths,
  executeAgentTool,
  findIsPathUnderRoots,
  normalizePath
}
export type { AgentToolContext }
