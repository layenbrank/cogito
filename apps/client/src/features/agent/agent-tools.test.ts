import { describe, expect, it } from 'vitest'

import { verifyAgentTools } from '@/features/agent/agent-tools'

describe('agent 工具面自检', function () {
  it('按词边界匹配，避免 corex_action 误命中 corex_actions', function () {
    const result = verifyAgentTools(
      ['mcp_corex-mcp_corex_actions', 'corex__corex_action', 'corex_validate'],
      'corex'
    )
    expect(result.present).toEqual(expect.arrayContaining(['corex_actions', 'corex_action', 'corex_validate']))
    expect(result.missing).not.toContain('corex_actions')
  })

  it('缺失与意外工具都能报出来', function () {
    const result = verifyAgentTools(['corex_actions', 'corex_legacy_tool'], 'corex')
    expect(result.missing).toContain('corex_run')
    expect(result.unexpected).toContain('corex_legacy_tool')
  })
})
