import { describe, expect, it } from 'vitest'

import {
  AUTOMATION_APPROVAL,
  AUTO_PROMPT,
  READONLY_PROMPT,
  findAutomationSystemPrompt,
  findInitialPhase,
  parseAutomationApproval,
  shouldApprove,
  shouldContinueToGoal,
  summarizeRunOutput
} from '@/features/automation/run-plan'

describe('parseAutomationApproval', function () {
  it('只认 auto，其余一律按只读（失败关闭）', function () {
    expect(parseAutomationApproval('auto')).toBe('auto')
    expect(parseAutomationApproval('readonly')).toBe('readonly')
    expect(parseAutomationApproval('ask')).toBe('readonly')
    expect(parseAutomationApproval('')).toBe('readonly')
    expect(parseAutomationApproval(null)).toBe('readonly')
    expect(parseAutomationApproval(undefined)).toBe('readonly')
  })
})

describe('shouldApprove', function () {
  it('只有自动批准档才放行审批请求', function () {
    expect(shouldApprove(AUTOMATION_APPROVAL.auto)).toBe(true)
    expect(shouldApprove(AUTOMATION_APPROVAL.readonly)).toBe(false)
  })
})

describe('findInitialPhase / shouldContinueToGoal', function () {
  it('流水线开则先 plan，再衔接到 goal', function () {
    expect(findInitialPhase(true, 'agent')).toBe('plan')
    expect(findInitialPhase(false, 'goal')).toBe('goal')
    expect(shouldContinueToGoal(true, 'plan')).toBe(true)
    expect(shouldContinueToGoal(true, 'goal')).toBe(false)
    expect(shouldContinueToGoal(false, 'plan')).toBe(false)
  })
})

describe('findAutomationSystemPrompt', function () {
  it('按档位分叉：只读不许写，自动批准限定工作目录', function () {
    expect(findAutomationSystemPrompt('readonly')).toBe(READONLY_PROMPT)
    expect(findAutomationSystemPrompt('auto')).toBe(AUTO_PROMPT)
    expect(READONLY_PROMPT).toContain('只做只读工作')
    expect(AUTO_PROMPT).toContain('不要越界')
    // 两档都不该出现「向用户提问」
    expect(READONLY_PROMPT).toContain('不要向用户提问')
    expect(AUTO_PROMPT).toContain('不要向用户提问')
  })

  it('给了工作目录就把绝对路径摊开，并点名不许越界', function () {
    const prompt = findAutomationSystemPrompt('auto', 'agent', 'C:\\work\\proj-a')
    expect(prompt).toContain('C:\\work\\proj-a')
    expect(prompt).toContain('不要访问这个目录之外的任何文件')
    // 没给目录时不编一句空话
    expect(findAutomationSystemPrompt('auto')).toBe(AUTO_PROMPT)
    expect(findAutomationSystemPrompt('readonly', 'agent', '  ')).toBe(READONLY_PROMPT)
  })
})

describe('summarizeRunOutput', function () {
  it('拒绝次数写进输出尾巴：用户能看出是权限拦住了', function () {
    const text = summarizeRunOutput('整理完成', { denied: 3, granted: 0, blocked: 0 }, 'readonly')
    expect(text).toBe('整理完成\n\n（本轮有 3 次工具调用因无人审批被拒绝）')
  })

  it('自动批准只报批准次数，不报拒绝', function () {
    const text = summarizeRunOutput(
      '已写入 report.txt',
      { denied: 0, granted: 2, blocked: 0 },
      'auto'
    )
    expect(text).toBe('已写入 report.txt\n\n（本轮自动批准了 2 次工具调用）')
  })

  it('没有审批往返时不加尾巴；空输出给兜底文案', function () {
    expect(summarizeRunOutput('  ', { denied: 0, granted: 0, blocked: 0 }, 'readonly')).toBe(
      '（模型没有输出内容）'
    )
    expect(summarizeRunOutput('完成', { denied: 0, granted: 0, blocked: 0 }, 'auto')).toBe('完成')
  })

  it('只读档即使 granted 有值也不报（不该出现的组合，不误导）', function () {
    expect(summarizeRunOutput('完成', { denied: 0, granted: 5, blocked: 0 }, 'readonly')).toBe(
      '完成'
    )
  })

  it('越界被拦要写在记录里：用户才知道任务为什么没做完', function () {
    const text = summarizeRunOutput('改了 2 个文件', { denied: 0, granted: 3, blocked: 2 }, 'auto')
    expect(text).toBe(
      '改了 2 个文件\n\n（本轮有 2 次工具调用越出任务目录被拒绝）\n（本轮自动批准了 3 次工具调用）'
    )
    // 只读档不会走到越界分支（审批一律拒绝），不额外报
    expect(summarizeRunOutput('完成', { denied: 1, granted: 0, blocked: 2 }, 'readonly')).toBe(
      '完成\n\n（本轮有 1 次工具调用因无人审批被拒绝）'
    )
  })
})
