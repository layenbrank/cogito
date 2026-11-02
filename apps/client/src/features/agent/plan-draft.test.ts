import type { ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import { findPlanDraft } from '@/features/agent/plan-draft'

/** 只需要 role + text part，其余字段与判定无关 */
function assistant(text: string): ThreadMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] } as unknown as ThreadMessage
}

function user(text: string): ThreadMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as unknown as ThreadMessage
}

describe('计划草稿抽取', function () {
  it('编号列表进 steps，正文原样保留', function () {
    const body = [
      '# 终端块折叠',
      '',
      '## 概述',
      '工具卡的终端改成默认折叠。',
      '',
      '## 实施步骤',
      '1. `tool-card-terminal-body` 加折叠',
      '2. 详情页列出正在运行的命令',
      '',
      '## 验证',
      '| 命令 | 断言 |',
      '| --- | --- |',
      '| tsc | 通过 |'
    ].join('\n')

    const draft = findPlanDraft([user('改一下终端'), assistant(body)])
    expect(draft?.title).toBe('终端块折叠')
    expect(draft?.overview).toBe('工具卡的终端改成默认折叠。')
    expect(draft?.steps).toEqual([
      'tool-card-terminal-body 加折叠',
      '详情页列出正在运行的命令'
    ])
    // 正文必须是全量：验证表格不能被裁掉
    expect(draft?.body).toContain('| tsc | 通过 |')
  })

  it('计划类标题下的普通项目符号也算步骤（清单不再落盘后模型常这么写）', function () {
    const body = [
      '# 审阅工作台',
      '',
      '## 实施步骤',
      '- 先补 upstream 读取',
      '- 再补 push 与远端分支',
      '- 最后收敛状态栏'
    ].join('\n')

    const draft = findPlanDraft([assistant(body)])
    expect(draft?.steps).toHaveLength(3)
  })

  it('没有计划类标题时，普通项目符号不当作计划（避免任何列表都被认成计划）', function () {
    const body = ['## 说明', '', '- 这是解释', '- 不是步骤'].join('\n')
    expect(findPlanDraft([assistant(body)])).toBeNull()
  })

  it('没有列表时不产出草稿，正文段不会被当成步骤', function () {
    const body = ['# 汇报', '', '一切都好，没有后续步骤。'].join('\n')
    expect(findPlanDraft([assistant(body)])).toBeNull()
  })

  it('取最后一条有正文的 assistant 消息', function () {
    const first = '# 旧计划\n\n## 实施步骤\n1. 旧步骤一\n2. 旧步骤二'
    const second = '# 新计划\n\n## 实施步骤\n1. 新步骤一\n2. 新步骤二'
    const draft = findPlanDraft([assistant(first), assistant(second)])
    expect(draft?.title).toBe('新计划')
  })
})
