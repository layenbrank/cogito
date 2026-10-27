/**
 * 编辑器内联 AI 的三个动作：续写 / 重写选区 / 总结。
 *
 * 这里只做两件确定性的事：**准备输入**（取选区、上下文、拼指令）与**落地结果**
 * （按动作决定插纯文本还是成段的 HTML）。模型调用在 `features/agent/inline-prompt`。
 */
import type { Editor } from '@tiptap/react'

import { t } from '@/views/knowledge/locale.ts'
import { parseMarkdown } from '@/views/knowledge/lib/parse-markdown.ts'

type AiAction = 'continue' | 'rewrite' | 'summarize'

interface AiRange {
  from: number
  to: number
}

interface AiPlan {
  action: AiAction
  /** 被替换的原文（预览里的「删除」侧）；续写与总结为空 */
  original: string
  /** 结果落点：续写是光标位置，改写是选区，总结是选区或文末 */
  range: AiRange
  /** 交给模型的一轮消息 */
  prompt: string
}

interface AiActionMeta {
  label: string
  icon: string
  /** 必须选中一段才能用 */
  needsSelection: boolean
}

/** 续写只看光标前这么长的上文：再长也不会让续写更贴，只会更慢更贵 */
const CONTINUE_CONTEXT_LIMIT = 2_000
/** 总结无选区时最多读这么多字符（整篇塞进上下文没有意义） */
const SUMMARIZE_DOC_LIMIT = 6_000

const AI_ACTIONS: Record<AiAction, AiActionMeta> = {
  continue: { label: t('AI_CONTINUE'), icon: 'lucide:pen-line', needsSelection: false },
  rewrite: { label: t('AI_REWRITE'), icon: 'lucide:wand-sparkles', needsSelection: true },
  summarize: { label: t('AI_SUMMARIZE'), icon: 'lucide:list', needsSelection: false }
}

/** 选区/段落的纯文本：块之间用空行隔开，模型看到的层次才不至于糊成一段 */
function sliceText(editor: Editor, range: AiRange): string {
  return editor.state.doc.textBetween(range.from, range.to, '\n\n', '\n').trim()
}

function findSelectionRange(editor: Editor): AiRange | null {
  const { from, to, empty } = editor.state.selection
  return empty ? null : { from, to }
}

function findCursorRange(editor: Editor): AiRange {
  const position = editor.state.selection.to
  return { from: position, to: position }
}

function tail(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(value.length - limit)
}

function head(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit)
}

function buildContinuePrompt(context: string): string {
  return `下面是笔记中光标之前的正文。请顺着语气与话题续写，直接给出接下来的正文，不要重复已有内容，也不要写标题：\n\n${context}`
}

function buildRewritePrompt(original: string): string {
  return `请改写下面这段正文：保留原意与事实，语气与原文一致，Markdown 结构可以调整。只输出改写后的正文：\n\n${original}`
}

function buildSummarizePrompt(source: string): string {
  return `请把下面的正文压缩成要点总结：最多 5 条 Markdown 列表项，只留结论与关键数据，不要复述原文：\n\n${source}`
}

/**
 * 把动作用户意图翻译成一次请求。返回 null 表示当前状态下这个动作做不了
 * （没选中、文档为空等），由调用方给一句提示。
 */
function findAiPlan(editor: Editor, action: AiAction): AiPlan | null {
  const selection = findSelectionRange(editor)
  if (action === 'rewrite') {
    if (!selection) return null
    const original = sliceText(editor, selection)
    if (!original) return null
    return { action, original, range: selection, prompt: buildRewritePrompt(original) }
  }

  if (action === 'summarize') {
    const source = selection
      ? sliceText(editor, selection)
      : head(editor.getText(), SUMMARIZE_DOC_LIMIT).trim()
    if (!source) return null
    return {
      action,
      original: '',
      // 无选区时总结追加到文末，而不是悄悄替换光标所在的位置
      range: selection ?? { from: editor.state.doc.content.size, to: editor.state.doc.content.size },
      prompt: buildSummarizePrompt(source)
    }
  }

  const cursor = editor.state.selection.to
  const context = tail(sliceText(editor, { from: 0, to: cursor }), CONTINUE_CONTEXT_LIMIT).trim()
  if (!context) return null
  return {
    action,
    original: '',
    range: findCursorRange(editor),
    prompt: buildContinuePrompt(context)
  }
}

/** 模型偶尔仍会包一层代码围栏：去掉它，否则正文里会真的出现 ``` */
function stripCodeFence(value: string): string {
  const trimmed = value.trim()
  const matched = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(trimmed)
  return matched ? matched[1].trim() : trimmed
}

/**
 * 落进文档。续写按纯文本接上（模型给的是一段话，不是结构），
 * 改写与总结按 Markdown → HTML 插入，保留标题、列表等结构。
 * 一次 `insertContentAt` 就是一个撤销步，用户 Ctrl+Z 能整体回退。
 */
function applyAiResult(editor: Editor, plan: AiPlan, content: string): void {
  const body = stripCodeFence(content)
  if (!body) return
  if (plan.action === 'continue') {
    editor.chain().focus().insertContentAt(plan.range, body).run()
    return
  }
  editor.chain().focus().insertContentAt(plan.range, parseMarkdown(body).html).run()
}

export { AI_ACTIONS, applyAiResult, findAiPlan, sliceText, stripCodeFence }
export type { AiAction, AiPlan, AiRange }
