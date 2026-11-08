import { describe, expect, it } from 'vitest'

import { BODY_START } from '@/features/agent/plan-execute'
import { buildBoundPlanPrompt, findBoundPlanTarget } from '@/features/automation/bound-plan'

const BODY = ['# 审阅升级', '', '## 实施步骤', '1. 改后端', '', '## 验证', '| cargo test | 通过 |'].join(
  '\n'
)

describe('findBoundPlanTarget', function () {
  it('agent 走执行，其余（含 plan）一律按目标推进', function () {
    expect(findBoundPlanTarget('agent')).toBe('agent')
    expect(findBoundPlanTarget('goal')).toBe('goal')
    expect(findBoundPlanTarget('plan')).toBe('goal')
  })
})

describe('buildBoundPlanPrompt', function () {
  it('与右栏同源：发出计划全文与文件路径', function () {
    const prompt = buildBoundPlanPrompt({
      body: BODY,
      overview: '一句话',
      filePath: '.cogito/plans/foo.md',
      mode: 'goal',
      budget: 6
    })
    expect(prompt).toContain(BODY_START)
    expect(prompt).toContain('改后端')
    expect(prompt).toContain('| cargo test | 通过 |')
    expect(prompt).toContain('计划文件：.cogito/plans/foo.md')
    expect(prompt).toContain('最多 6 轮')
  })

  it('任务 prompt 非空时前置附加说明，不盖掉计划正文', function () {
    const prompt = buildBoundPlanPrompt({
      body: BODY,
      filePath: '.cogito/plans/foo.md',
      note: '优先改桌面端',
      mode: 'agent',
      budget: 6
    })
    expect(prompt).toMatch(/^## 附加说明\n优先改桌面端\n/)
    expect(prompt).toContain(BODY_START)
    expect(prompt).toContain('改后端')
  })

  it('空 note 不加附加说明段', function () {
    const prompt = buildBoundPlanPrompt({
      body: BODY,
      filePath: '.cogito/plans/foo.md',
      note: '   ',
      mode: 'agent',
      budget: 3
    })
    expect(prompt).not.toContain('附加说明')
    expect(prompt.startsWith('按下面的计划开始执行')).toBe(true)
  })
})
