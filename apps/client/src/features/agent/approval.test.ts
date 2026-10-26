import { describe, expect, it } from 'vitest'

import { classifyToolEffect, isWriteTool } from '@/features/agent/approval'

describe('工具效果分类', function () {
  it('读工具不触发审批', function () {
    expect(classifyToolEffect('read_file')).toBe('read')
    expect(classifyToolEffect('app_calendar_read')).toBe('read')
    expect(classifyToolEffect('app_knowledge_search')).toBe('read')
    expect(classifyToolEffect('app_workspace_list')).toBe('read')
    expect(classifyToolEffect('corex_actions')).toBe('read')
    expect(classifyToolEffect('corex_validate')).toBe('read')
    expect(classifyToolEffect('list_runs')).toBe('read')
  })

  it('写工具一定触发审批（含 create/append/update/save/index/run）', function () {
    expect(isWriteTool('write_file')).toBe(true)
    expect(isWriteTool('app_knowledge_write_doc')).toBe(true)
    expect(isWriteTool('calendar.create')).toBe(true)
    expect(isWriteTool('memo.append')).toBe(true)
    expect(isWriteTool('knowledge_index')).toBe(true)
    expect(isWriteTool('corex_run')).toBe(true)
    expect(isWriteTool('corex_invoke')).toBe(true)
  })

  it('未知 app_ 工具失败关闭（按写）', function () {
    expect(classifyToolEffect('app_something_new')).toBe('write')
  })
})
