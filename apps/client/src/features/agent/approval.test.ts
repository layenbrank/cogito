import { describe, expect, it } from 'vitest'

import {
  classifyToolEffect,
  clearApprovalModeFor,
  findGooseMode,
  findHardDenyLevel,
  findToolPermissionLevel,
  isLegacyFileWriter,
  isOpaqueShellTool,
  isWriteTool,
  readApprovalModeFor,
  writeApprovalModeFor
} from '@/features/agent/approval'
import { findPref } from '@/features/persist'

describe('工具效果分类', function () {
  it('读工具不触发审批', function () {
    expect(classifyToolEffect('read_file')).toBe('read')
    expect(classifyToolEffect('cogito_calendar_read')).toBe('read')
    expect(classifyToolEffect('cogito_knowledge_search')).toBe('read')
    expect(classifyToolEffect('cogito_knowledge_lint')).toBe('read')
    expect(classifyToolEffect('cogito_knowledge_read_wiki')).toBe('read')
    expect(classifyToolEffect('cogito_knowledge_graph_search')).toBe('read')
    expect(classifyToolEffect('cogito_workspace_list')).toBe('read')
    expect(classifyToolEffect('corex_actions')).toBe('read')
    expect(classifyToolEffect('corex_validate')).toBe('read')
    expect(classifyToolEffect('list_runs')).toBe('read')
  })

  it('写工具一定触发审批（含 create/append/update/save/index/run/text_editor）', function () {
    expect(isWriteTool('write_file')).toBe(true)
    expect(isWriteTool('cogito_knowledge_write_doc')).toBe(true)
    expect(isWriteTool('cogito_knowledge_ingest')).toBe(true)
    expect(isWriteTool('cogito_knowledge_workspace_write')).toBe(true)
    expect(isWriteTool('calendar.create')).toBe(true)
    expect(isWriteTool('memo.append')).toBe(true)
    expect(isWriteTool('knowledge_index')).toBe(true)
    expect(isWriteTool('corex_run')).toBe(true)
    expect(isWriteTool('corex_invoke')).toBe(true)
    expect(isWriteTool('developer__shell')).toBe(true)
    expect(isWriteTool('developer__text_editor')).toBe(true)
    expect(isWriteTool('str_replace')).toBe(true)
  })

  it('未知 cogito_ 工具失败关闭（按写）', function () {
    expect(classifyToolEffect('cogito_something_new')).toBe('write')
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

  it('Goose 黑盒 shell 在任意策略下均为 never_allow；cogito_terminal_* 不受影响', function () {
    expect(isOpaqueShellTool('shell')).toBe(true)
    expect(isOpaqueShellTool('developer__shell')).toBe(true)
    expect(isOpaqueShellTool('cogito_terminal_run')).toBe(false)
    expect(isOpaqueShellTool('local__cogito_terminal_run')).toBe(false)
    // 名字里有 exec ≠ 黑盒 shell：以前 includes('exec') 会把 execute_javascript 判成
    // never_allow，goose 静默拒绝 —— 用户看到「询问审批」却没有任何人问他
    expect(isOpaqueShellTool('execute_javascript')).toBe(false)
    expect(isOpaqueShellTool('developer__execute_javascript')).toBe(false)
    expect(findToolPermissionLevel('auto', 'shell')).toBe('never_allow')
    expect(findToolPermissionLevel('ask', 'developer__shell')).toBe('never_allow')
    expect(findToolPermissionLevel('readonly', 'bash')).toBe('never_allow')
    expect(findToolPermissionLevel('auto', 'cogito_terminal_run')).toBe('always_allow')
    expect(findToolPermissionLevel('ask', 'cogito_terminal_run')).toBe('ask_before')
  })

  it('goose 内置文件写工具在任意策略下均为 never_allow（写文件只能经 cogito_workspace_*）', function () {
    expect(isLegacyFileWriter('text_editor')).toBe(true)
    expect(isLegacyFileWriter('developer__text_editor')).toBe(true)
    expect(isLegacyFileWriter('str_replace')).toBe(true)
    expect(isLegacyFileWriter('developer__apply_patch')).toBe(true)
    expect(isLegacyFileWriter('apply_diff')).toBe(true)
    // 本地写入口自身已有 guard，不受这条限制
    expect(isLegacyFileWriter('cogito_workspace_write')).toBe(false)
    expect(isLegacyFileWriter('cogito_workspace_patch')).toBe(false)
    expect(isLegacyFileWriter('cogito_knowledge_write_doc')).toBe(false)

    expect(findToolPermissionLevel('auto', 'developer__text_editor')).toBe('never_allow')
    expect(findToolPermissionLevel('ask', 'str_replace')).toBe('never_allow')
    expect(findToolPermissionLevel('readonly', 'developer__apply_patch')).toBe('never_allow')
    // auto 档下写入口仍然放行（guard 在执行层，不在审批层）
    expect(findToolPermissionLevel('auto', 'cogito_workspace_write')).toBe('always_allow')
    expect(findToolPermissionLevel('ask', 'cogito_workspace_patch')).toBe('ask_before')
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

describe('审批档写入立即生效', function () {
  it('落盘还在路上，UI 读到的已是新档（不能停在上一档）', function () {
    const threadID = 'thread-instant'
    writeApprovalModeFor(threadID, 'auto')
    expect(readApprovalModeFor(threadID)).toBe('auto')
    writeApprovalModeFor(threadID, 'readonly')
    expect(readApprovalModeFor(threadID)).toBe('readonly')
  })

  it('清除后立即回落到全局默认', function () {
    const threadID = 'thread-instant-clear'
    writeApprovalModeFor(threadID, 'auto')
    expect(readApprovalModeFor(threadID)).toBe('auto')
    clearApprovalModeFor(threadID)
    expect(readApprovalModeFor(threadID)).not.toBe('auto')
  })
})

describe('工具效果回归（分词判定 + fail-closed）', function () {
  it('只读工具不再被动词里的短子串误判成写', function () {
    // 旧实现：`includes('get')` 会命中 target / budget / widget，`includes('action')` 同理
    expect(classifyToolEffect('cogito_browser_open')).toBe('read')
    expect(classifyToolEffect('cogito_browser_wait')).toBe('read')
    expect(classifyToolEffect('cogito_browser_screenshot')).toBe('read')
    expect(classifyToolEffect('cogito_browser_network')).toBe('read')
    expect(classifyToolEffect('cogito_agent_wait')).toBe('read')
    expect(classifyToolEffect('cogito_agent_result')).toBe('read')
    expect(classifyToolEffect('cogito_code_symbols')).toBe('read')
    expect(classifyToolEffect('cogito_code_outline')).toBe('read')
    expect(classifyToolEffect('cogito_code_refs')).toBe('read')
    expect(classifyToolEffect('cogito_code_impact')).toBe('read')
  })

  it('写动词优先：带 server 前缀也命中', function () {
    expect(classifyToolEffect('local__cogito_terminal_run')).toBe('write')
    expect(classifyToolEffect('mcp__local__cogito_workspace_patch')).toBe('write')
    expect(classifyToolEffect('cogito_browser_act')).toBe('write')
    expect(classifyToolEffect('cogito_browser_intercept')).toBe('write')
    expect(classifyToolEffect('cogito_browser_device')).toBe('write')
    expect(classifyToolEffect('cogito_agent_spawn')).toBe('write')
  })

  it('认不出来的工具一律按写（第三方 MCP 不能默认放行）', function () {
    expect(classifyToolEffect('github_push_files')).toBe('write')
    expect(classifyToolEffect('slack_send_message')).toBe('write')
    expect(classifyToolEffect('deploy_trigger')).toBe('write')
    expect(classifyToolEffect('acme__budget')).toBe('write')
  })

  it('硬禁用与档位无关：只写进 permission.yaml 的就是这两类', function () {
    expect(findHardDenyLevel('developer__text_editor')).toBe('never_allow')
    expect(findHardDenyLevel('bash')).toBe('never_allow')
    expect(findHardDenyLevel('cogito_terminal_run')).toBeNull()
    expect(findHardDenyLevel('cogito_workspace_write')).toBeNull()
  })
})
