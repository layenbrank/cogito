import { describe, expect, it } from 'vitest'

import {
  findGooseMode,
  findHardDenyLevel,
  isLegacyFileWriter,
  isLocalTool,
  isOpaqueShellTool,
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
