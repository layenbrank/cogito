import { describe, expect, it } from 'vitest'

import { buildPlanMarkdown } from '@/features/agent/plan-file'

describe('计划文件', function () {
  it('frontmatter 放总结与清单，正文全量保留', function () {
    const markdown = buildPlanMarkdown({
      title: 'Canvas 预览',
      overview: '抽通用 Konva 壳',
      steps: ['改 a.ts', '跑单测: pnpm unit'],
      body: '# Canvas 预览\n\n## 问题\n老实现不行。\n'
    })
    expect(markdown.startsWith('---\nname: Canvas 预览\noverview: 抽通用 Konva 壳\ntodos:\n')).toBe(
      true
    )
    expect(markdown).toContain('  - id: step-1\n    content: 改 a.ts\n    status: pending')
    // 含半角冒号的步骤必须加引号，否则 YAML 会把它解析成映射
    expect(markdown).toContain('content: "跑单测: pnpm unit"')
    // 正文原样写入，正文自带的 H1 不再重复补一次
    expect(markdown).toContain('## 问题\n老实现不行。')
    expect(markdown.match(/# Canvas 预览/g)).toHaveLength(1)
  })

  it('没有正文时退化成编号步骤，且不写空 overview', function () {
    const markdown = buildPlanMarkdown({ title: 'T', overview: '', steps: ['a', 'b'], body: '' })
    expect(markdown).toContain('# T\n\n1. a\n2. b')
    expect(markdown).not.toContain('overview:')
  })
})
