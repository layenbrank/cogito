import { describe, expect, it } from 'vitest'

import {
  classifyToolEffect,
  clearApprovalModeFor,
  findGooseMode,
  findToolPermissionLevel,
  isOpaqueShellTool,
  isWriteTool,
  readApprovalModeFor,
  writeApprovalModeFor
} from '@/features/agent/approval'
import { findPref } from '@/features/persist'

describe('工具效果分类', function () {
  it('读工具不触发审批', function () {
    expect(classifyToolEffect('read_file')).toBe('read')
    expect(classifyToolEffect('app_calendar_read')).toBe('read')
    expect(classifyToolEffect('app_knowledge_search')).toBe('read')
    expect(classifyToolEffect('app_knowledge_lint')).toBe('read')
    expect(classifyToolEffect('app_knowledge_read_wiki')).toBe('read')
    expect(classifyToolEffect('app_workspace_list')).toBe('read')
    expect(classifyToolEffect('corex_actions')).toBe('read')
    expect(classifyToolEffect('corex_validate')).toBe('read')
    expect(classifyToolEffect('list_runs')).toBe('read')
  })

  it('写工具一定触发审批（含 create/append/update/save/index/run/text_editor）', function () {
    expect(isWriteTool('write_file')).toBe(true)
    expect(isWriteTool('app_knowledge_write_doc')).toBe(true)
    expect(isWriteTool('app_knowledge_ingest')).toBe(true)
    expect(isWriteTool('calendar.create')).toBe(true)
    expect(isWriteTool('memo.append')).toBe(true)
    expect(isWriteTool('knowledge_index')).toBe(true)
    expect(isWriteTool('corex_run')).toBe(true)
    expect(isWriteTool('corex_invoke')).toBe(true)
    expect(isWriteTool('developer__shell')).toBe(true)
    expect(isWriteTool('developer__text_editor')).toBe(true)
    expect(isWriteTool('str_replace')).toBe(true)
  })

  it('未知 app_ 工具失败关闭（按写）', function () {
    expect(classifyToolEffect('app_something_new')).toBe('write')
  })
})

describe('审批策略 → goose 会话 mode', function () {
  it('询问审批 / 只读 → smart_approve（否则默认 auto 会跳过 permission.yaml）', function () {
    expect(findGooseMode('ask')).toBe('smart_approve')
    expect(findGooseMode('readonly')).toBe('smart_approve')
  })

  it('自动审批 → auto', function () {
    expect(findGooseMode('auto')).toBe('auto')
  })
})

describe('审批策略 → goose 权限档', function () {
  it('询问审批：写工具 ask_before，读工具 always_allow', function () {
    expect(findToolPermissionLevel('ask', 'write_file')).toBe('ask_before')
    expect(findToolPermissionLevel('ask', 'read_file')).toBe('always_allow')
  })

  it('自动审批：非 shell 写工具 always_allow', function () {
    expect(findToolPermissionLevel('auto', 'write_file')).toBe('always_allow')
  })

  it('只读：写工具 never_allow，读工具 always_allow', function () {
    expect(findToolPermissionLevel('readonly', 'write_file')).toBe('never_allow')
    expect(findToolPermissionLevel('readonly', 'read_file')).toBe('always_allow')
  })

  it('Goose 黑盒 shell 在任意策略下均为 never_allow；app_terminal_* 不受影响', function () {
    expect(isOpaqueShellTool('shell')).toBe(true)
    expect(isOpaqueShellTool('developer__shell')).toBe(true)
    expect(isOpaqueShellTool('app_terminal_run')).toBe(false)
    expect(findToolPermissionLevel('auto', 'shell')).toBe('never_allow')
    expect(findToolPermissionLevel('ask', 'developer__shell')).toBe('never_allow')
    expect(findToolPermissionLevel('readonly', 'bash')).toBe('never_allow')
    expect(findToolPermissionLevel('auto', 'app_terminal_run')).toBe('always_allow')
    expect(findToolPermissionLevel('ask', 'app_terminal_run')).toBe('ask_before')
  })
})

describe('一次性任务会话的审批档', function () {
  it('automation- 会话的档只走内存，不写 agent.json', function () {
    const threadID = 'automation-run-memory'
    writeApprovalModeFor(threadID, 'auto')
    expect(readApprovalModeFor(threadID)).toBe('auto')
    // 每分钟任务会「开跑写一次 + 跑完清一次」，两次落盘没有意义
    expect(findPref('agent').approvalByThread[threadID]).toBeUndefined()

    clearApprovalModeFor(threadID)
    expect(readApprovalModeFor(threadID)).not.toBe('auto')
  })

  it('并发的一次性会话互不影响：清掉 A 不影响 B', function () {
    writeApprovalModeFor('automation-run-a', 'auto')
    writeApprovalModeFor('automation-run-b', 'readonly')
    expect(readApprovalModeFor('automation-run-a')).toBe('auto')
    expect(readApprovalModeFor('automation-run-b')).toBe('readonly')

    clearApprovalModeFor('automation-run-a')
    expect(readApprovalModeFor('automation-run-a')).not.toBe('auto')
    expect(readApprovalModeFor('automation-run-b')).toBe('readonly')
    clearApprovalModeFor('automation-run-b')
  })
})
