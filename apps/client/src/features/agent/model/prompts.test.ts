import { describe, expect, it } from 'vitest'

import { findSystemPrompt } from '@/features/agent/model/prompts'
import { toAgentToolLabel } from '@/features/agent/tool-labels'

describe('指令场景系统提示', function () {
  it('directive 场景使用 corex-mcp 的实际工具名', function () {
    const prompt = findSystemPrompt('directive')
    expect(prompt).toContain('corex_actions')
    expect(prompt).toContain('corex_action')
    expect(prompt).toContain('corex_validate')
    expect(prompt).toContain('corex_invoke')
    expect(prompt).toContain('corex_run')
    expect(prompt).toContain('corex_directive')
  })

  it('directive 场景明确不落库，保存由客户端完成', function () {
    const prompt = findSystemPrompt('directive')
    expect(prompt).toContain('不要落库')
  })

  it('general 场景也提示可用 corex MCP 编排指令', function () {
    expect(findSystemPrompt('general')).toContain('corex MCP')
  })

  it('directive/general 注入能力地图；plan 注入当前时间', function () {
    const withCapability = findSystemPrompt('directive', {
      capabilitySummary: '## corex 动作目录（共 2 个）'
    })
    expect(withCapability).toContain('corex 动作目录')
    expect(findSystemPrompt('compare', { capabilitySummary: '不该出现的能力地图' })).not.toContain(
      '不该出现的能力地图'
    )

    const plan = findSystemPrompt('plan', {
      now: '2026年10月26日 星期一',
      timeZone: 'Asia/Shanghai'
    })
    expect(plan).toContain('当前时间：2026年10月26日 星期一')
    expect(plan).toContain('Asia/Shanghai')
  })
})

describe('corex 工具中文标签', function () {
  it('命中 MCP 实际名与带 server 前缀的名字', function () {
    expect(toAgentToolLabel('corex_actions')).toBe('列出动作')
    expect(toAgentToolLabel('mcp_corex-mcp_corex_actions')).toBe('列出动作')
    expect(toAgentToolLabel('corex__corex_run')).toBe('运行指令')
    expect(toAgentToolLabel('corex_validate')).toBe('校验指令')
  })
})
