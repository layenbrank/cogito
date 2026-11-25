import { describe, expect, it } from 'vitest'

import { classifyToolEffect, isCommandTool, isWriteTool, stripServerPrefix } from './tool-effect'

describe('stripServerPrefix', function () {
  it('剥掉 goose 的 server 前缀', function () {
    expect(stripServerPrefix('local__cogito_terminal_run')).toBe('cogito_terminal_run')
    expect(stripServerPrefix('mcp__local__cogito_terminal_run')).toBe('cogito_terminal_run')
    expect(stripServerPrefix('  Plain_Tool  ')).toBe('plain_tool')
  })
})

describe('isCommandTool', function () {
  it('只把终端命令算成命令类：它们改的是外部状态，不是仓库文件', function () {
    expect(isCommandTool('local__cogito_terminal_run')).toBe(true)
    expect(isCommandTool('cogito_terminal_write')).toBe(true)
    expect(isCommandTool('cogito_workspace_write')).toBe(false)
    expect(isCommandTool('cogito_terminal_read')).toBe(false)
  })
})

describe('classifyToolEffect', function () {
  it('本地读写工具分别判到 read / write', function () {
    expect(classifyToolEffect('cogito_workspace_read')).toBe('read')
    expect(classifyToolEffect('cogito_workspace_write')).toBe('write')
    expect(classifyToolEffect('cogito_knowledge_search')).toBe('read')
    expect(classifyToolEffect('cogito_knowledge_ingest')).toBe('write')
  })

  it('写动词优先：terminal run 按写；查看类终端工具按读', function () {
    expect(classifyToolEffect('cogito_terminal_run')).toBe('write')
    expect(classifyToolEffect('cogito_terminal_read')).toBe('read')
    expect(classifyToolEffect('cogito_terminal_list')).toBe('read')
  })

  it('打开网页是副作用，不因 open 落在只读动词里就放行', function () {
    expect(classifyToolEffect('cogito_browser_open')).toBe('write')
    expect(classifyToolEffect('cogito_browser_read')).toBe('read')
  })

  it('第三方 MCP 的写工具不会被误判成只读', function () {
    expect(classifyToolEffect('push_files')).toBe('write')
    expect(classifyToolEffect('send_message')).toBe('write')
  })

  it('歧义动词（open / fetch）不再把有副作用的工具判成只读', function () {
    // `open_pr` 建 PR、`fetch_url` 可能是 webhook：宁可多问一次，也不能在 auto 档直接放行
    expect(classifyToolEffect('open_pr')).toBe('write')
    expect(classifyToolEffect('fetch_url')).toBe('write')
    // 已知只读的联网工具由精确名单兜住，不因上述收紧而被误拦
    expect(classifyToolEffect('webfetch')).toBe('read')
    expect(classifyToolEffect('websearch')).toBe('read')
    expect(classifyToolEffect('local__web_fetch')).toBe('read')
  })

  it('认不出来的按写（fail-closed）', function () {
    expect(classifyToolEffect('budget_get')).toBe('write')
    expect(classifyToolEffect('weird_unknown_tool')).toBe('write')
    expect(isWriteTool('weird_unknown_tool')).toBe(true)
  })
})
