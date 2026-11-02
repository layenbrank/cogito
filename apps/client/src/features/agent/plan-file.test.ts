import { describe, expect, it } from 'vitest'

import { buildPlanMarkdown } from '@/features/agent/plan-file'

describe('计划文件', function () {
  it('frontmatter 只放总结，不再写 todos 清单', function () {
    const markdown = buildPlanMarkdown({
      title: 'Canvas 预览',
      overview: '抽通用 Konva 壳',
      steps: ['改 a.ts', '跑单测 pnpm unit'],
      body: '# Canvas 预览\n\n## 问题\n老实现不行。\n'
    })
    expect(markdown.startsWith('---\nname: Canvas 预览\noverview: 抽通用 Konva 壳\nisProject: false\n---\n')).toBe(
      true
    )
    // 清单一旦落盘就会被当「任务全集」读取，正文里的细节会被跳过
    expect(markdown).not.toContain('todos:')
    expect(markdown).not.toContain('status: pending')
    // 正文原样写入，正文自带的 H1 不再重复补一个
    expect(markdown).toContain('## 问题\n老实现不行。')
    expect(markdown.match(/# Canvas 预览/g)).toHaveLength(1)
  })

  it('没有正文时退化成编号步骤，且不写空 overview', function () {
    const markdown = buildPlanMarkdown({ title: 'T', overview: '', steps: ['a', 'b'], body: '' })
    expect(markdown).toContain('# T\n\n1. a\n2. b')
    expect(markdown).not.toContain('overview:')
  })

  it('含冒号的标题与总结按 YAML 双引号标量写出', function () {
    const markdown = buildPlanMarkdown({
      title: '计划: 分阶段',
      overview: '',
      steps: [],
      body: 'x'
    })
    expect(markdown).toContain('name: "计划: 分阶段"')
  })
})
