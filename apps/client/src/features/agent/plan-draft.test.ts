import type { ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import { findPlanDraft } from '@/features/agent/plan-draft'

/** 只用到 role + text part，其余字段对抽取逻辑无意义 */
function assistant(text: string): ThreadMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }]
  } as unknown as ThreadMessage
}

/** Cursor `.cursor/plans/*.plan.md` 的正文骨架（frontmatter 已被客户端剥掉的情况） */
const CURSOR_STYLE = `# Clipchamp Canvas 预览 + 通用 Konva 抽取

## 问题

当前 \`preview.tsx\` 用绝对定位 \`<video>\` 叠层，无法可靠做变换手柄。

## 选定方案

单一客户端画布内核，四个命名 Layer 自下而上挂载。

## 实施步骤

1. 新建 lib/canvas：metrics + 四层 Stage
2. Preview 四层：背景底板、媒体视频、内容文字、交互 Transformer
3. Capture 四层：暗底、截图媒体、标注内容、选区交互

## 验证

1x/2x DPR 与 PiP 竖屏清晰度验收。
`

describe('计划抽取', function () {
  it('Cursor 骨架：标题、概述、清单、全量正文各就各位', function () {
    const draft = findPlanDraft([assistant(CURSOR_STYLE)])
    expect(draft).not.toBeNull()
    expect(draft?.title).toBe('Clipchamp Canvas 预览 + 通用 Konva 抽取')
    // 没有 `## 概述`，退到全文第一个正文段
    expect(draft?.overview).toContain('无法可靠做变换手柄')
    expect(draft?.steps).toEqual([
      '新建 lib/canvas：metrics + 四层 Stage',
      'Preview 四层：背景底板、媒体视频、内容文字、交互 Transformer',
      'Capture 四层：暗底、截图媒体、标注内容、选区交互'
    ])
    // 全量：不剔除步骤、不截断，验证段必须还在
    expect(draft?.body).toBe(CURSOR_STYLE.trim())
    expect(draft?.body).toContain('## 验证')
    expect(draft?.body).toContain('## 实施步骤')
  })

  it('有 `## 概述` 时用它当总结，正文仍保留完整章节', function () {
    const text = `# 计划标题

## 概述

把 A 换成 B，影响面只有 utils。

## 现状与问题

老实现走 X。

## 实施步骤

1. 改 utils/a.ts
2. 跑单测

## 验证

pnpm unit。`
    const draft = findPlanDraft([assistant(text)])
    expect(draft?.overview).toBe('把 A 换成 B，影响面只有 utils。')
    expect(draft?.steps).toEqual(['改 utils/a.ts', '跑单测'])
    expect(draft?.body).toContain('## 验证')
  })

  it('只有清单没有标题时也能抽出，title 为空串', function () {
    const text = `先说结论：直接改。

1. 改 a.ts
2. 改 b.ts`
    const draft = findPlanDraft([assistant(text)])
    expect(draft?.title).toBe('')
    expect(draft?.overview).toBe('先说结论：直接改。')
    expect(draft?.steps).toEqual(['改 a.ts', '改 b.ts'])
  })

  it('结构化 JSON 优先于正文里的列表', function () {
    const text = `## 实施步骤

1. 正文里的第一条
2. 正文里的第二条

\`\`\`json
{"steps":[{"title":"JSON 第一条"},{"title":"JSON 第二条"}]}
\`\`\``
    const draft = findPlanDraft([assistant(text)])
    expect(draft?.steps).toEqual(['JSON 第一条', 'JSON 第二条'])
  })

  it('没有列表也没有结构化输出时返回 null', function () {
    expect(findPlanDraft([assistant('就一段话，没有任何清单。')])).toBeNull()
  })
})
