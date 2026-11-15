import { describe, expect, it } from 'vitest'

import { findServerOf, matchesTool, verifyAgentTools } from '@/features/agent/agent-tools'

describe('agent 工具面自检', function () {
  it('先剥 server 前缀再比对，避免 corex_action 误命中 corex_actions', function () {
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

  it('本地工具是全名 `local__cogito_*`：剥前缀后按成员表命中', function () {
    const names = ['local__cogito_terminal_run', 'local__cogito_workspace_read']
    const result = verifyAgentTools(names, 'local')
    expect(result.present).toEqual(
      expect.arrayContaining(['cogito_terminal_run', 'cogito_workspace_read'])
    )
    expect(result.missing).toContain('cogito_knowledge_search')
    // 成员表外的同前缀工具算「意外」，工具面漂移要能被发现
    expect(verifyAgentTools(['local__cogito_ghost'], 'local').unexpected).toContain(
      'local__cogito_ghost'
    )
  })

  it('server 归属：前缀优先，其次成员表', function () {
    expect(findServerOf('local__cogito_browser_read')).toBe('local')
    expect(findServerOf('mcp__local__cogito_browser_read')).toBe('local')
    expect(findServerOf('corex__corex_actions')).toBe('corex')
    // 没前缀的裸名靠成员表兜住
    expect(findServerOf('cogito_calendar_read')).toBe('local')
    expect(findServerOf('read_file')).toBeNull()
  })

  it('匹配是整名相等，不是后缀', function () {
    expect(matchesTool('local__cogito_code_action', 'cogito_code_actions')).toBe(false)
    expect(matchesTool('local__cogito_code_actions', 'cogito_code_actions')).toBe(true)
  })
})
