import { describe, expect, it } from 'vitest'

import { buildPlanExecutePrompt, BODY_START } from '@/features/agent/plan-execute'

const BODY = [
  '# 审阅升级',
  '',
  '## 实施步骤',
  '',
  '1. 后端读：新增 workspaceGit:upstream',
  '2. 后端写：push + 远端分支',
  '',
  '## 验证',
  '| 命令 | 断言 |',
  '| --- | --- |',
  '| cargo test | 通过 |'
].join('\n')

describe('按计划执行的提示词', function () {
  it('把计划正文全文发回去，而不是只发清单', function () {
    const prompt = buildPlanExecutePrompt({ body: BODY, target: 'agent' })
    expect(prompt).toContain(BODY_START)
    // 正文里的文件级细节与验证表格必须原样在场
    expect(prompt).toContain('新增 workspaceGit:upstream')
    expect(prompt).toContain('| cargo test | 通过 |')
    expect(prompt).toContain('# 审阅升级')
  })

  it('下发阶段顺序与验证要求，且不重复拼一份编号清单', function () {
    const prompt = buildPlanExecutePrompt({ body: BODY, target: 'agent' })
    expect(prompt).toContain('严格按计划的阶段顺序推进')
    expect(prompt).toContain('逐条跑一遍并汇报结果')
    // 清单式重复只应来自正文本身，不能再额外拼一遍
    expect(prompt.match(/1\. 后端读：新增 workspaceGit:upstream/g)).toHaveLength(1)
  })

  it('目标模式带上轮次上限与不断问的约束', function () {
    const prompt = buildPlanExecutePrompt({ body: BODY, target: 'goal', budget: 5 })
    expect(prompt).toContain('最多 5 轮')
    expect(prompt).toContain('中途不要停下来问用户')
  })

  it('带 revision 时 prompt 里保留版本号（没有计划文件也要带）', function () {
    const prompt = buildPlanExecutePrompt({ body: BODY, target: 'agent', revision: 3 })
    expect(prompt).toContain('revision 3')
    expect(prompt).not.toContain('计划文件：')
  })

  it('正文缺失时退回 overview，两者都空时只有要求部分', function () {
    expect(
      buildPlanExecutePrompt({ body: '  ', target: 'agent', overview: '抽通用 Konva 壳' })
    ).toContain('抽通用 Konva 壳')
    const bare = buildPlanExecutePrompt({ body: '', target: 'agent' })
    expect(bare).toContain('执行要求')
    expect(bare).not.toContain(BODY_START)
  })
})
