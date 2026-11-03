/**
 * 划词 Ask / Edit：经 ACP 改写或问答，结果写回 TipTap。
 */
import { runInlinePrompt } from '@/features/agent/inline-prompt'

type SelectionEditMode = 'ask' | 'edit'

interface SelectionEditInput {
  mode: SelectionEditMode
  selection: string
  instruction: string
  documentContext?: string
}

async function runSelectionEdit(input: SelectionEditInput): Promise<string> {
  const selection = input.selection.trim()
  if (!selection) throw new Error('未选中文本')
  const instruction = input.instruction.trim() || (input.mode === 'ask' ? '解释这段话' : '润色这段话')

  if (input.mode === 'ask') {
    return runInlinePrompt({
      text: [
        `用户问题：${instruction}`,
        '',
        '选中文本：',
        selection,
        '',
        '文档上下文（节选）：',
        (input.documentContext || '').slice(0, 3_000)
      ].join('\n'),
      systemText: '你是知识库助手。直接回答问题，可引用选中文本。不要调用工具。'
    })
  }

  return runInlinePrompt({
    text: [
      `改写指令：${instruction}`,
      '',
      '原文：',
      selection,
      '',
      '请只输出改写后的 Markdown 片段，不要解释。'
    ].join('\n'),
    systemText: '你是编辑助手。只输出可直接替换原文的 Markdown。不要调用工具。'
  })
}

export { runSelectionEdit }
export type { SelectionEditInput, SelectionEditMode }
