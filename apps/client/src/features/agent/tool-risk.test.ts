import { describe, expect, it } from 'vitest'

import { findToolRisk, GUARDED_TOOLS, RISK_META } from '@/features/agent/tool-risk'

describe('工具风险级别', function () {
  it('受保护写入工具标 guarded（含 goose 的 server 前缀）', function () {
    expect(findToolRisk('app_workspace_write')).toBe('guarded')
    expect(findToolRisk('app_workspace_patch')).toBe('guarded')
    expect(findToolRisk('mcp__cogito__app_workspace_write')).toBe('guarded')
    expect(findToolRisk('cogito:app_workspace_patch')).toBe('guarded')
  })

  it('其余写工具 write、读工具 read', function () {
    expect(findToolRisk('app_terminal_run')).toBe('write')
    expect(findToolRisk('app_knowledge_write_doc')).toBe('write')
    expect(findToolRisk('app_knowledge_search')).toBe('read')
    expect(findToolRisk('app_browser_read')).toBe('read')
    expect(findToolRisk('read_file')).toBe('read')
  })

  it('三个级别都有可展示的标签与提示', function () {
    const risks = ['read', 'write', 'guarded'] as const
    for (const risk of risks) {
      expect(RISK_META[risk].label.length).toBeGreaterThan(0)
      expect(RISK_META[risk].hint.length).toBeGreaterThan(0)
    }
    expect(GUARDED_TOOLS).toContain('app_workspace_write')
    expect(GUARDED_TOOLS).toContain('app_workspace_patch')
  })
})
