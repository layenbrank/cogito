import { describe, expect, it } from 'vitest'

import { classifyToolEffect, isWriteTool, stripServerPrefix } from './tool-effect'

describe('stripServerPrefix', function () {
  it('剥掉 goose 的 server 前缀', function () {
    expect(stripServerPrefix('local__cogito_terminal_run')).toBe('cogito_terminal_run')
    expect(stripServerPrefix('mcp__local__cogito_terminal_run')).toBe('cogito_terminal_run')
    expect(stripServerPrefix('  Plain_Tool  ')).toBe('plain_tool')
  })
})

describe('classifyToolEffect', function () {
  it('本地读写工具分别判到 read / write', function () {
    expect(classifyToolEffect('cogito_workspace_read')).toBe('read')
    expect(classifyToolEffect('cogito_workspace_write')).toBe('write')
    expect(classifyToolEffect('cogito_knowledge_search')).toBe('read')
    expect(classifyToolEffect('cogito_knowledge_ingest')).toBe('write')
  })

  it('写动词优先：terminal 同时含 read 语义也按写', function () {
    expect(classifyToolEffect('cogito_terminal_list')).toBe('write')
  })

  it('第三方 MCP 的写工具不会被误判成只读', function () {
    expect(classifyToolEffect('push_files')).toBe('write')
    expect(classifyToolEffect('send_message')).toBe('write')
  })

  it('认不出来的按写（fail-closed）', function () {
    expect(classifyToolEffect('budget_get')).toBe('write')
    expect(classifyToolEffect('weird_unknown_tool')).toBe('write')
    expect(isWriteTool('weird_unknown_tool')).toBe(true)
  })
})
