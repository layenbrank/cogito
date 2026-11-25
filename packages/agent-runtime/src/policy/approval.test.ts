/**
 * 审批业务判定的单元测试。
 *
 * 这是「工具会不会在你没同意的情况下执行」的判定，必须逐条锁住。
 * 用例从 `apps/client/src/features/agent/approval-decision.test.ts` 原样上提 ——
 * 上提的意义就是让 client 与扩展共用同一组断言，而不是各锁一半。
 */

import { describe, expect, it } from 'vitest'

import { decideApproval, type ApprovalDecisionInput } from './approval'

/** goose 实际下发的四个选项（`handle_tool_permission_request` 里固定四项） */
const OPTIONS = [
  { optionId: 'allow_always', kind: 'allow_always' },
  { optionId: 'allow_once', kind: 'allow_once' },
  { optionId: 'reject_once', kind: 'reject_once' },
  { optionId: 'reject_always', kind: 'reject_always' }
]

function input(overrides: Partial<ApprovalDecisionInput>): ApprovalDecisionInput {
  return {
    toolName: 'local__cogito_workspace_write',
    approvalMode: 'ask',
    planning: false,
    goalActive: false,
    options: OPTIONS,
    ...overrides
  }
}

describe('硬禁用与档位无关', function () {
  it('黑盒 shell 在 auto 档也拒（auto 下 goose 本来会无条件放行）', function () {
    expect(decideApproval(input({ toolName: 'shell', approvalMode: 'auto' }))).toEqual({
      kind: 'deny',
      optionId: 'reject_once'
    })
  })

  it('goose 原厂写工具在询问档下推卡，由用户决定（不再静默拒绝）', function () {
    expect(decideApproval(input({ toolName: 'write', approvalMode: 'ask' }))).toEqual({
      kind: 'ask'
    })
    expect(decideApproval(input({ toolName: 'developer__text_editor' }))).toEqual({ kind: 'ask' })
  })

  it('计划模式仍然直接拒：那一轮不该落盘，没有「允许一次」的语义', function () {
    expect(decideApproval(input({ toolName: 'write', planning: true }))).toEqual({
      kind: 'deny',
      optionId: 'reject_once'
    })
  })

  it('非询问档拿不到 reject_once 时 fail-closed，而不是把卡推给用户', function () {
    expect(
      decideApproval(
        input({
          toolName: 'shell',
          approvalMode: 'readonly',
          options: [{ optionId: 'allow_once', kind: 'allow_once' }]
        })
      ).kind
    ).toBe('cancel')
  })

  it('本地工具不受硬禁用影响（只读档由下一道规则处理）', function () {
    expect(decideApproval(input({ toolName: 'local__cogito_terminal_run' })).kind).toBe('ask')
  })
})

describe('只读档与计划模式', function () {
  it('写工具拒，且用的是 reject_once 而不是 cancelled', function () {
    expect(decideApproval(input({ approvalMode: 'readonly' }))).toEqual({
      kind: 'deny',
      optionId: 'reject_once'
    })
  })

  it('只读工具自动放行（approve 档下每个工具都会发审批请求）', function () {
    expect(
      decideApproval(input({ toolName: 'local__cogito_workspace_read', approvalMode: 'readonly' }))
    ).toEqual({ kind: 'allow', optionId: 'allow_once' })
  })

  it('问答的只读能力面与计划一样拒写，不看审批档是不是自动', function () {
    expect(decideApproval(input({ readOnlySession: true, approvalMode: 'auto' }))).toEqual({
      kind: 'deny',
      optionId: 'reject_once'
    })
    expect(
      decideApproval(input({ toolName: 'cogito_workspace_read', readOnlySession: true, approvalMode: 'auto' }))
    ).toEqual({ kind: 'allow', optionId: 'allow_once' })
  })

  it('计划模式与只读档同一条路径', function () {
    expect(decideApproval(input({ planning: true })).kind).toBe('deny')
    expect(decideApproval(input({ planning: true, toolName: 'cogito_workspace_list' }))).toEqual({
      kind: 'allow',
      optionId: 'allow_once'
    })
  })

  it('只读工具拿不到 allow_once 时退回问用户，而不是中止回合', function () {
    expect(
      decideApproval(
        input({
          toolName: 'cogito_workspace_read',
          approvalMode: 'readonly',
          options: [{ optionId: 'reject_once', kind: 'reject_once' }]
        })
      ).kind
    ).toBe('ask')
  })

  it('计划模式对命令类工具问用户（要调研就得能跑只读命令），文件写仍直接拒', function () {
    // 命令：推卡；用户点「允许一次」才跑
    expect(
      decideApproval(input({ toolName: 'local__cogito_terminal_run', planning: true }))
    ).toEqual({ kind: 'ask' })
    // 文件写：同样在计划模式，仍然直接拒（计划轮不落盘）
    expect(
      decideApproval(input({ toolName: 'local__cogito_workspace_write', planning: true }))
    ).toEqual({ kind: 'deny', optionId: 'reject_once' })
  })

  it('问答模式不走命令例外：它是「只读回答」，命令一律拒', function () {
    expect(
      decideApproval(
        input({ toolName: 'cogito_terminal_run', readOnlySession: true, approvalMode: 'auto' })
      )
    ).toEqual({ kind: 'deny', optionId: 'reject_once' })
  })

  it('计划模式的命令卡拿不到 allow_once 时 fail-closed（不推一张点不了的卡）', function () {
    expect(
      decideApproval(
        input({
          toolName: 'cogito_terminal_run',
          planning: true,
          options: [{ optionId: 'reject_once', kind: 'reject_once' }]
        })
      )
    ).toEqual({ kind: 'deny', optionId: 'reject_once' })
  })
})

describe('目标推进', function () {
  it('仅当用户本身就是自动审批时才替用户放行', function () {
    expect(decideApproval(input({ goalActive: true, approvalMode: 'auto' }))).toEqual({
      kind: 'allow',
      optionId: 'allow_once'
    })
  })

  it('目标推进但档位是询问时仍然问用户', function () {
    expect(decideApproval(input({ goalActive: true, approvalMode: 'ask' })).kind).toBe('ask')
  })

  it('放行时拿不到 allow_once 就按取消结案（不能悄悄跳过闸门）', function () {
    expect(
      decideApproval(
        input({
          goalActive: true,
          approvalMode: 'auto',
          options: [{ optionId: 'reject_once', kind: 'reject_once' }]
        })
      ).kind
    ).toBe('cancel')
  })
})

describe('默认分支', function () {
  it('普通写工具在询问档下推给用户', function () {
    expect(decideApproval(input({}))).toEqual({ kind: 'ask' })
  })

  it('auto 档下 cogito 自己的工具直接放行（goose 不会发请求，这里只是防御）', function () {
    // auto 档 goose 不发审批请求；真发来了也不该拦本地工具
    expect(decideApproval(input({ approvalMode: 'auto' })).kind).toBe('ask')
  })
})
