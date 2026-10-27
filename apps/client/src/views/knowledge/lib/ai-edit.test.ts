import type { Editor } from '@tiptap/react'
import { describe, expect, it } from 'vitest'

import { findAiPlan, stripCodeFence } from '@/views/knowledge/lib/ai-edit.ts'

/** 只要有 `state.doc.textBetween` / `state.selection` / `getText` 就够跑计划逻辑 */
function stubEditor(input: { doc: string; from: number; to?: number }): Editor {
  const text = input.doc
  const to = input.to ?? text.length
  return {
    state: {
      selection: { from: input.from, to, empty: to === input.from },
      doc: {
        content: { size: text.length + 2 },
        textBetween: function (from: number, end: number) {
          return from >= end ? '' : text.slice(from, end)
        }
      }
    },
    getText: function () {
      return text
    }
  } as unknown as Editor
}

describe('findAiPlan', function () {
  it('重写必须有选区', function () {
    const editor = stubEditor({ doc: '一段正文', from: 2, to: 2 })
    expect(findAiPlan(editor, 'rewrite')).toBeNull()
  })

  it('重写把选区文本当原文，并要求只输出正文', function () {
    const editor = stubEditor({ doc: '一段正文', from: 0, to: 2 })
    const plan = findAiPlan(editor, 'rewrite')
    expect(plan?.original).toBe('一段')
    expect(plan?.range).toEqual({ from: 0, to: 2 })
    expect(plan?.prompt).toContain('一段')
  })

  it('总结无选区时落在文末，不覆盖光标处', function () {
    const editor = stubEditor({ doc: '一整篇正文', from: 3, to: 3 })
    const plan = findAiPlan(editor, 'summarize')
    expect(plan?.original).toBe('')
    expect(plan?.range).toEqual({ from: 7, to: 7 })
  })

  it('续写取光标之前的正文作上下文', function () {
    const editor = stubEditor({ doc: '已经写好的开头', from: 7, to: 7 })
    const plan = findAiPlan(editor, 'continue')
    expect(plan?.range).toEqual({ from: 7, to: 7 })
    expect(plan?.prompt).toContain('已经写好的')
  })

  it('光标在最前面时没得续写', function () {
    const editor = stubEditor({ doc: '正文', from: 0, to: 0 })
    expect(findAiPlan(editor, 'continue')).toBeNull()
  })
})

describe('stripCodeFence', function () {
  it('去掉模型多包的一层围栏', function () {
    expect(stripCodeFence('```markdown\n# 标题\n正文\n```')).toBe('# 标题\n正文')
  })

  it('没有围栏时原样返回', function () {
    expect(stripCodeFence('  # 标题  ')).toBe('# 标题')
  })
})
