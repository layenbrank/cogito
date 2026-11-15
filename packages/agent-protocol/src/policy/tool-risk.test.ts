import { describe, expect, it } from 'vitest'

import { GUARDED_TOOLS, RISK_META, findToolRisk } from './tool-risk'

describe('findToolRisk', function () {
  it('受保护写入按名字识别，容忍 server 前缀与冒号分隔', function () {
    expect(findToolRisk('cogito_workspace_write')).toBe('guarded')
    expect(findToolRisk('local__cogito_workspace_patch')).toBe('guarded')
    expect(findToolRisk('mcp__cogito_workspace_write')).toBe('guarded')
    expect(GUARDED_TOOLS.length).toBe(2)
  })

  it('其余按 isWriteTool 分 read / write', function () {
    expect(findToolRisk('cogito_workspace_read')).toBe('read')
    expect(findToolRisk('cogito_terminal_run')).toBe('write')
  })

  it('三级都有展示元数据', function () {
    expect(RISK_META.read.variant).toBe('outline')
    expect(RISK_META.write.variant).toBe('secondary')
    expect(RISK_META.guarded.variant).toBe('destructive')
  })
})
