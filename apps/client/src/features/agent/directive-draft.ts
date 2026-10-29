/**
 * 指令草稿解析：把助手回复里的 JSON 变成可校验的指令定义。
 *
 * 设计要点：
 * - **只认结构化输出**：agent 不落库、不调写工具；我们从消息里挑 JSON 代码块。
 * - 容错：允许整段就是 JSON、允许外面再包一层 `{ "definition": … }`。
 * - 校验双保险：本地 zod 先挡形状错误，`validateDirective` 再走 daemon 的严格校验。
 */
import { toast } from 'sonner'

import { writeDraftStatus } from '@/lib/directive-draft-ipc'
import { validateDirective } from '@/lib/directive-ipc'
import { DICT_VALUE } from '@/shared/ipc/specs/dict'
import { DirectiveContentSchema, type DirectiveContent } from '@/shared/ipc/specs/sidecar'
import { rememberPendingDefinition } from '@/stores/corex'
import { useDirectiveDraftStore } from '@/stores/directive-draft'
import type { DirectiveDraft } from '@/lib/directive-draft-ipc'
import { reportCaught } from '@/utils/exception-report'

type DirectiveDraftParse =
  | { ok: true; definition: DirectiveContent; raw: string }
  | { ok: false; reason: string; raw: string }

/** 抽取所有 ```json / ``` 围栏里的内容；没有围栏时退回整段 */
function extractCandidates(text: string): string[] {
  const candidates: string[] = []
  const fenced = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g
  let match = fenced.exec(text)
  while (match) {
    const body = match[1]?.trim()
    if (body) candidates.push(body)
    match = fenced.exec(text)
  }
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) candidates.push(trimmed)
  return candidates
}

/** 单个候选里的 JSON 对象（容忍 JSON 前后还有说明文字） */
function extractObjects(candidate: string): unknown[] {
  const objects: unknown[] = []
  const start = candidate.indexOf('{')
  let depth = 0
  let inString = false
  let escaped = false
  let from = -1
  for (let index = start; index >= 0 && index < candidate.length; index += 1) {
    const char = candidate[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) from = index
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0 && from >= 0) {
        const slice = candidate.slice(from, index + 1)
        try {
          objects.push(JSON.parse(slice))
        } catch (error) {
          // 单块不是合法 JSON 就跳过，继续找下一块（不算异常，只做调试可见性）
          console.debug('[agent/directive-draft] 跳过非 JSON 块:', error)
        }
        from = -1
      }
      if (depth < 0) depth = 0
    }
  }
  return objects
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && 'definition' in value) {
    const inner = (value as { definition?: unknown }).definition
    if (inner && typeof inner === 'object') return inner
  }
  return value
}

/**
 * 从助手回复里解析指令草稿。
 *
 * 只有带 `name` + `steps` 的对象才算候选（避免把普通说明里的 JSON 当草稿）。
 */
function parseDirectiveDraft(text: string): DirectiveDraftParse {
  const candidates = extractCandidates(text)
  let lastReason = '没有找到指令草稿（需要一个包含 name 与 steps 的 JSON）'
  for (const candidate of candidates) {
    for (const object of extractObjects(candidate)) {
      const value = unwrap(object)
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      if (typeof record.name !== 'string' || !Array.isArray(record.steps)) continue
      const parsed = DirectiveContentSchema.safeParse(record)
      if (parsed.success) return { ok: true, definition: parsed.data, raw: candidate }
      lastReason = parsed.error.issues
        .slice(0, 3)
        .map(function (issue) {
          const path = issue.path.join('.')
          return path ? `${path}: ${issue.message}` : issue.message
        })
        .join('；')
    }
  }
  return { ok: false, reason: lastReason, raw: text }
}

type DraftValidation = { ok: true; name: string } | { ok: false; error: string }

/** 交给 corex daemon 做严格校验（与保存走同一套规则） */
async function validateDraft(definition: DirectiveContent): Promise<DraftValidation> {
  try {
    const reply = await validateDirective({ definition })
    return { ok: true, name: reply.name }
  } catch (error) {
    // 校验失败是**预期路径**（草稿不合法），但要留给用户看，所以原样返回错误信息
    reportCaught('agent.validateDraft', error, 'warning')
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 运行收尾：把助手回复里的草稿落进收件箱（只用于 directive 场景）。
 *
 * 失败不应影响本轮对话：只提示，不抛。
 */
async function captureDirectiveDraft(
  text: string,
  meta: { threadID?: string; workspaceID?: string | null }
): Promise<DirectiveDraft | null> {
  const parsed = parseDirectiveDraft(text)
  if (!parsed.ok) return null
  const validation = await validateDraft(parsed.definition)
  const draft = await useDirectiveDraftStore.getState().save({
    threadID: meta.threadID ?? null,
    workspaceID: meta.workspaceID ?? null,
    name: parsed.definition.name,
    definition: JSON.stringify(parsed.definition)
  })
  if (!draft) return null
  if (!validation.ok) {
    await writeDraftStatus({
      id: draft.id,
      status: DICT_VALUE.DIRECTIVE_DRAFT_STATUS.PENDING,
      error: validation.error
    })
    toast.warning('已生成指令草稿，但校验未通过', { description: validation.error })
    return draft
  }
  toast.success('已生成指令草稿', { description: `「${validation.name}」待确认` })
  return draft
}

/** 在指令编辑器里打开草稿（不落库；保存由编辑器里的「保存」按钮完成） */
async function openDraftInEditor(draft: DirectiveDraft): Promise<void> {
  let definition: DirectiveContent
  try {
    definition = DirectiveContentSchema.parse(JSON.parse(draft.definition))
  } catch (error) {
    toast.error('草稿内容已损坏，无法打开', {
      description: error instanceof Error ? error.message : String(error)
    })
    reportCaught('agent.openDraftInEditor', error, 'warning')
    return
  }
  // 定义先放进「待应用」槽：进编辑器时工作区会 openEditor + seedPendingDraft，
  // 在导航前直接替换 draft 会被那一步清空。带上行 id，保存后才能把收件箱那行收尾
  rememberPendingDefinition(definition, draft.id)
  const { router } = await import('@/routers')
  await router.navigate(`/directive/${encodeURIComponent(definition.name)}`)
}

export {
  captureDirectiveDraft,
  extractCandidates,
  extractObjects,
  openDraftInEditor,
  parseDirectiveDraft,
  validateDraft
}
export type { DirectiveDraftParse, DraftValidation }
