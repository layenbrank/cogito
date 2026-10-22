import { describe, expect, it } from 'vitest'

import { findSystemPrompt } from '@/features/agent/model/prompts'
import { toAgentToolLabel } from '@/features/agent/tool-labels'

describe('指令场景系统提示', function () {
  it('directive 场景要求用 corex 动作目录实现并验证', function () {
    const prompt = findSystemPrompt('directive')
    expect(prompt).toContain('list_actions')
    expect(prompt).toContain('save_directive')
    expect(prompt).toContain('validate_directive')
    expect(prompt).toContain('run_directive')
    expect(prompt).toContain('invoke')
  })

  it('general 场景也提示可用 corex MCP 编排指令', function () {
    expect(findSystemPrompt('general')).toContain('corex MCP')
  })
})

describe('corex 工具中文标签', function () {
  it('命中 daemon 同名与带前缀的 goose 工具名', function () {
    expect(toAgentToolLabel('save_directive')).toBe('保存指令')
    expect(toAgentToolLabel('corex__run_directive')).toBe('运行指令')
    expect(toAgentToolLabel('mcp_list_actions')).toBe('列出动作')
    expect(toAgentToolLabel('validate_directive')).toBe('校验指令')
  })
})
