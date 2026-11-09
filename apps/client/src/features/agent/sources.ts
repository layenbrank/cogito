/**
 * 「来源」：这一轮回答建立在哪些材料上。
 *
 * 卡片此前只读 `composer.attachments`，但 `@` 引用工作区文件走的是 chip
 * （线格式 `@path`，见 design 的 composer-document），附件行只放 Ctrl+V 粘贴的
 * 文件和图片 —— 于是这一格永远是空的。现在三路合并，按可信度排序：
 *
 * 1. 引用（`referenced`）：用户消息正文里的 `@path` / `@browser-<uuid>` / `@skill:<名>`；
 * 2. 附件（`attached`）：composer 附件行 + 用户消息里的 file / image part；
 * 3. 读取（`read`）：本轮被 read / view 类工具真正读过的文件。
 *
 * 同一目标只留一条，`引用 > 附件 > 读取` —— 用户显式点名的排最前。
 * mention 解析复用 composer 的规则（`parseDocument`），所以 `@media` / `@types`
 * 这类装饰性写法不会被当成来源。
 */
import type { ThreadMessage } from '@assistant-ui/react'

import { parseDocument, toChipType } from '@cogito/design/assistant/composer-document'

import { findArgPath, normalizeToolPath } from './tool-paths.ts'

/** 载体类型：决定图标与点击行为 */
type AgentSourceKind = 'file' | 'browser' | 'skill'

/** 怎么进来的：决定分组与排序 */
type AgentSourceUsage = 'referenced' | 'attached' | 'read'

interface AgentSource {
  /** 去重键：路径 / `browser-<uuid>` / `skill:<名>` */
  readonly id: string
  readonly kind: AgentSourceKind
  readonly usage: AgentSourceUsage
  /** 展示名：引用路径 / 标签页 label / 技能名 */
  readonly label: string
  /** 悬停全文 */
  readonly detail: string
  /** 文件类来源给右栏文件树用的路径；其他为 null */
  readonly relative: string | null
}

interface AgentSourceGroup {
  readonly usage: AgentSourceUsage
  readonly label: string
  readonly sources: AgentSource[]
}

/** 一屏放得下、又不至于把长会话的文件全列出来 */
const SOURCE_LIMIT = 12

const USAGE_ORDER: readonly AgentSourceUsage[] = ['referenced', 'attached', 'read']

const USAGE_LABEL: Record<AgentSourceUsage, string> = {
  referenced: '引用',
  attached: '附件',
  read: '读取'
}

/** `text_editor` 靠 command 区分读写；其余工具按名字判断 */
function findToolCommand(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const record = args as Record<string, unknown>
  const command = record.command
  return typeof command === 'string' ? command.toLowerCase() : null
}

/**
 * 是否「读取」类工具：写 / 改不算来源。
 *
 * `text_editor` 的 view 是读、str_replace 是写，所以先看 command 再看名字；
 * shell / bash 里的 cat 读不到结构化路径，不计入。
 */
function isReadTool(name: string, args: unknown): boolean {
  const lower = name.toLowerCase()
  if (lower.includes('shell') || lower.includes('bash') || lower.includes('terminal')) return false
  if (lower.includes('editor') || lower.includes('str_replace')) {
    return findToolCommand(args) === 'view'
  }
  if (lower.includes('write') || lower.includes('create') || lower.includes('edit')) return false
  if (lower.includes('read')) return true
  return lower === 'view' || lower.endsWith('__view')
}

function findSourceKind(id: string): AgentSourceKind {
  const type = toChipType(id)
  if (type === 'skill') return 'skill'
  if (type === 'browser') return 'browser'
  return 'file'
}

/** 用户引用：用户消息正文里的 chip（`@path` / `@browser-<uuid>` / `@skill:<名>`） */
function collectMentionSources(messages: readonly ThreadMessage[]): AgentSource[] {
  const sources: AgentSource[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const part of message.content) {
      if (part.type !== 'text') continue
      for (const atom of parseDocument(part.text)) {
        if (atom.kind !== 'chip') continue
        const kind = findSourceKind(atom.id)
        sources.push({
          id: atom.id,
          kind,
          usage: 'referenced',
          label: kind === 'skill' ? atom.label : atom.id,
          detail: atom.id,
          relative: kind === 'file' ? atom.id : null
        })
      }
    }
  }
  return sources
}

/** 附件：composer 附件行（Ctrl+V 粘贴）+ 用户消息里的 file / image part */
function collectAttachmentSources(
  messages: readonly ThreadMessage[],
  attachmentNames: readonly string[]
): AgentSource[] {
  const sources: AgentSource[] = []
  for (const name of attachmentNames) {
    if (!name) continue
    sources.push({ id: name, kind: 'file', usage: 'attached', label: name, detail: name, relative: null })
  }
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const part of message.content) {
      if (part.type !== 'file' && part.type !== 'image') continue
      const filename = typeof part.filename === 'string' ? part.filename : ''
      if (!filename) continue
      sources.push({
        id: filename,
        kind: 'file',
        usage: 'attached',
        label: filename,
        detail: filename,
        relative: null
      })
    }
  }
  return sources
}

/** 读取：本轮被读类工具真正打开过的文件 */
function collectReadSources(
  messages: readonly ThreadMessage[],
  rootPath: string | null
): AgentSource[] {
  const sources: AgentSource[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.content) {
      if (part.type !== 'tool-call') continue
      if (!isReadTool(part.toolName, part.args)) continue
      const raw = findArgPath(part.args)
      if (!raw) continue
      const path = normalizeToolPath(raw, rootPath)
      if (!path) continue
      sources.push({ id: path, kind: 'file', usage: 'read', label: path, detail: path, relative: path })
    }
  }
  return sources
}

/**
 * 三路合并：先按 引用 → 附件 → 读取 排列，再按 `id` 去重（先出现者胜）。
 */
function collectSources(input: {
  messages: readonly ThreadMessage[]
  attachmentNames: readonly string[]
  rootPath: string | null
  limit?: number
}): AgentSource[] {
  const merged = [
    ...collectMentionSources(input.messages),
    ...collectAttachmentSources(input.messages, input.attachmentNames),
    ...collectReadSources(input.messages, input.rootPath)
  ]
  const seen = new Set<string>()
  const sources: AgentSource[] = []
  for (const source of merged) {
    if (seen.has(source.id)) continue
    seen.add(source.id)
    sources.push(source)
    if (sources.length >= (input.limit ?? SOURCE_LIMIT)) break
  }
  return sources
}

/** 分组只保留非空桶，顺序固定：引用 / 附件 / 读取 */
function groupSources(sources: readonly AgentSource[]): AgentSourceGroup[] {
  const groups: AgentSourceGroup[] = []
  for (const usage of USAGE_ORDER) {
    const bucket = sources.filter(function (source) {
      return source.usage === usage
    })
    if (bucket.length === 0) continue
    groups.push({ usage, label: USAGE_LABEL[usage], sources: bucket })
  }
  return groups
}

function findSourceIcon(source: AgentSource): string {
  if (source.kind === 'browser') return 'lucide:globe'
  if (source.kind === 'skill') return 'lucide:sparkles'
  return 'lucide:file'
}

export { collectSources, findSourceIcon, groupSources, isReadTool }
export type { AgentSource, AgentSourceGroup, AgentSourceKind, AgentSourceUsage }
