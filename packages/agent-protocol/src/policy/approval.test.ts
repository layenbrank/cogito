import { describe, expect, it } from 'vitest'

import {
  findGooseMode,
  findHardDenyLevel,
  findHardDenyReplacement,
  isLegacyFileWriter,
  isLocalTool,
  isOpaqueShellTool,
  isPolicyDeniedText,
  listHardDenyToolNames
} from './approval'

describe('findGooseMode', function () {
  it('auto 直通；ask 靠 smart_approve 启审批通道', function () {
    expect(findGooseMode('auto')).toBe('auto')
    expect(findGooseMode('ask')).toBe('smart_approve')
  })

  it('readonly 走 approve：写工具不该押在模特的只读判定上', function () {
    expect(findGooseMode('readonly')).toBe('approve')
  })
})

describe('isLocalTool / isOpaqueShellTool / isLegacyFileWriter', function () {
  it('lock 表成员即本地工具，且本地工具不算黑盒 shell', function () {
    expect(isLocalTool('local__cogito_terminal_run')).toBe(true)
    expect(isOpaqueShellTool('local__cogito_terminal_run')).toBe(false)
  })

  it('goose 原生 shell 是黑盒', function () {
    expect(isOpaqueShellTool('shell')).toBe(true)
    expect(isOpaqueShellTool('run_command')).toBe(true)
  })

  it('名字里含 exec 但不在名单里的不算黑盒', function () {
    expect(isOpaqueShellTool('execute_javascript')).toBe(false)
  })

  it('goose 内置写工具一律识别', function () {
    expect(isLegacyFileWriter('text_editor')).toBe(true)
    expect(isLegacyFileWriter('apply_patch')).toBe(true)
    expect(isLegacyFileWriter('cogito_workspace_write')).toBe(false)
  })

  it('developer 扩展现行的 write / edit 也算内置写工具', function () {
    expect(isLegacyFileWriter('write')).toBe(true)
    expect(isLegacyFileWriter('edit')).toBe(true)
  })

  it('短名只做等值：本地工具与 todo 不被 write 子串误伤', function () {
    expect(isLegacyFileWriter('local__cogito_workspace_write')).toBe(false)
    expect(isLegacyFileWriter('todo__todo_write')).toBe(false)
    expect(isLegacyFileWriter('local__cogito_terminal_write')).toBe(false)
  })
})

describe('findHardDenyLevel', function () {
  it('黑盒 shell 与内置写工具与档位无关地硬禁用', function () {
    expect(findHardDenyLevel('shell')).toBe('never_allow')
    expect(findHardDenyLevel('text_editor')).toBe('never_allow')
    expect(findHardDenyLevel('cogito_workspace_write')).toBeNull()
  })

  it('developer 的 write / edit 与档位无关地硬禁用', function () {
    expect(findHardDenyLevel('write')).toBe('never_allow')
    expect(findHardDenyLevel('edit')).toBe('never_allow')
    expect(findHardDenyLevel('todo__todo_write')).toBeNull()
  })
})

describe('策略拒绝的识别', function () {
  // goose 的 DECLINED_RESPONSE 原文（tool_execution.rs 的 const，含后半句 STOP）
  const DECLINED =
    'The user has declined to run this tool. DO NOT attempt to call this tool again. ' +
    'If there are no alternative methods to proceed, clearly explain the situation and STOP.'

  it('识别 goose 的拒绝文案，包括被包在 JSON 里的情况', function () {
    expect(isPolicyDeniedText(DECLINED)).toBe(true)
    expect(isPolicyDeniedText(`{"error":${JSON.stringify(DECLINED)}}`)).toBe(true)
    expect(isPolicyDeniedText('The user has declined to run this tool.')).toBe(true)
  })

  it('普通工具输出不算', function () {
    expect(isPolicyDeniedText('file written')).toBe(false)
    expect(isPolicyDeniedText('')).toBe(false)
  })

  it('硬禁用给出替代入口，其余返回 null（那属于权限文件问题）', function () {
    expect(findHardDenyReplacement('shell')).toBe('cogito_terminal_run')
    expect(findHardDenyReplacement('write')).toBe(
      'cogito_workspace_write / cogito_workspace_patch'
    )
    // execute_javascript 不是硬禁用：它被拒只能是 permission.yaml 里的手动偏好
    expect(findHardDenyReplacement('execute_javascript')).toBeNull()
    expect(findHardDenyReplacement('local__cogito_terminal_run')).toBeNull()
  })
})

describe('findToolPermissionLevel 已移除', function () {
  it('listHardDenyToolNames 只挑硬禁用的，且去重', function () {
    expect(
      listHardDenyToolNames([
        'shell',
        'write',
        'edit',
        'local__cogito_workspace_write',
        'todo__todo_write',
        'cogito_workspace_read',
        'shell'
      ])
    ).toEqual(['shell', 'write', 'edit'])
  })
})
