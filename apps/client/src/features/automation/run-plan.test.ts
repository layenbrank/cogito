import { describe, expect, it } from 'vitest'

import {
  AUTOMATION_APPROVAL,
  AUTO_PROMPT,
  READONLY_PROMPT,
  findAutomationSystemPrompt,
  parseAutomationApproval,
  shouldApprove,
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
})

describe('summarizeRunOutput', function () {
  it('拒绝次数写进输出尾巴：用户能看出是权限拦住了', function () {
    const text = summarizeRunOutput('整理完成', { denied: 3, granted: 0 }, 'readonly')
    expect(text).toBe('整理完成\n\n（本轮有 3 次工具调用因无人审批被拒绝）')
  })

  it('自动批准只报批准次数，不报拒绝', function () {
    const text = summarizeRunOutput('已写入 report.txt', { denied: 0, granted: 2 }, 'auto')
    expect(text).toBe('已写入 report.txt\n\n（本轮自动批准了 2 次工具调用）')
  })

  it('没有审批往返时不加尾巴；空输出给兜底文案', function () {
    expect(summarizeRunOutput('  ', { denied: 0, granted: 0 }, 'readonly')).toBe(
      '（模型没有输出内容）'
    )
    expect(summarizeRunOutput('完成', { denied: 0, granted: 0 }, 'auto')).toBe('完成')
  })

  it('只读档即使 granted 有值也不报（不该出现的组合，不误导）', function () {
    expect(summarizeRunOutput('完成', { denied: 0, granted: 5 }, 'readonly')).toBe('完成')
  })
})
