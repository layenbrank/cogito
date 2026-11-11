import { describe, expect, it } from 'vitest'

import { findThinkingBudget, THINKING_BUDGETS } from '@/features/agent/model/thinking-budget'

describe('findThinkingBudget', function () {
  it('关闭思考不给预算', function () {
    expect(findThinkingBudget('off')).toBe(0)
  })

  it('档位越高预算越大（仪表的分母必须单调，否则条会往回跳）', function () {
    const levels = ['low', 'medium', 'high', 'max'] as const
    for (let index = 1; index < levels.length; index += 1) {
      expect(THINKING_BUDGETS[levels[index]]).toBeGreaterThan(THINKING_BUDGETS[levels[index - 1]])
    }
  })
})
