import { beforeEach, describe, expect, it } from 'vitest'

import { writeApprovalModeFor } from '@/features/agent/approval'
import { decideApprovalForThread } from '@/features/agent/approval-decision'
import {
  findEffectiveApprovalMode,
  findRunGooseMode,
  isReadOnlySession
} from '@/features/agent/effective-approval'
import { writeAgentMode } from '@/features/agent/mode'
import { setAgentModeThread } from '@/features/agent/mode'
import { isWriteTool } from '@/features/agent/approval'

describe('有效审批档', function () {
  beforeEach(async function () {
    setAgentModeThread('t-eff')
    writeApprovalModeFor('t-eff', 'ask')
    await writeAgentMode('agent')
  })

  it('计划模式不改用户的审批偏好', async function () {
    await writeAgentMode('plan')
    expect(findEffectiveApprovalMode('t-eff')).toBe('ask')
    expect(findEffectiveApprovalMode('t-eff', 'auto')).toBe('auto')
  })

  it('问答和计划发给 goose 的是 approve，执行才跟审批档', async function () {
    await writeAgentMode('ask')
    expect(findRunGooseMode('t-eff')).toBe('approve')
    await writeAgentMode('plan')
    expect(findRunGooseMode('t-eff')).toBe('approve')
    await writeAgentMode('agent')
    expect(findRunGooseMode('t-eff')).toBe('smart_approve')
  })

  it('执行模式用会话审批偏好', async function () {
    await writeAgentMode('agent')
    writeApprovalModeFor('t-eff', 'ask')
    expect(findEffectiveApprovalMode('t-eff')).toBe('ask')
  })

  it('本轮模式（消息快照）压过会话当前模式（F-013）', async function () {
    // 用户在计划档里重跑一条「执行」模式的老消息：提示词要它动手，
    // 会话档就不能再是 approve（否则每个写工具都要弹审批、写完还被拒）
    await writeAgentMode('plan')
    expect(findRunGooseMode('t-eff')).toBe('approve')
    expect(findRunGooseMode('t-eff', 'agent')).toBe('smart_approve')
    expect(isReadOnlySession('t-eff', 'agent')).toBe(false)
    // 反向：快照是计划 —— 即使现在切回执行，也必须先问我们
    await writeAgentMode('agent')
    expect(findRunGooseMode('t-eff', 'plan')).toBe('approve')
    expect(isReadOnlySession('t-eff', 'plan')).toBe(true)
    // 快照是问答同理
    expect(findRunGooseMode('t-eff', 'ask')).toBe('approve')
  })

  it('写工具名分类：text_editor / shell 为写，read_file 为读', function () {
    expect(isWriteTool('text_editor')).toBe(true)
    expect(isWriteTool('shell')).toBe(true)
    expect(isWriteTool('read_file')).toBe(false)
  })
})

describe('本轮模式决定审批判定（F-013）', function () {
  // 用没有被硬禁用的写工具（`text_editor` 属于 never_allow，任何档都拒，测不出模式差异）
  const WRITE_TOOL = 'cogito_workspace_write'
  const options = [
    { optionId: 'allow_once', kind: 'allow_once' },
    { optionId: 'reject_once', kind: 'reject_once' }
  ]

  beforeEach(async function () {
    setAgentModeThread('t-f013')
    writeApprovalModeFor('t-f013', 'auto')
    await writeAgentMode('plan')
  })

  it('计划档里重跑执行模式的老消息：写工具不再被计划档拒', function () {
    // 会话当前是计划档：不带本轮模式就会被判成计划 → 拒写
    expect(decideApprovalForThread('t-f013', WRITE_TOOL, options)).toEqual({
      kind: 'deny',
      optionId: 'reject_once'
    })
    // 带上本轮的快照（执行）→ 不再锁写，回到常规判定（`ask` = 交给人 / 由 goose 自动档处理）
    expect(decideApprovalForThread('t-f013', WRITE_TOOL, options, 'agent')).toEqual({
      kind: 'ask'
    })
  })

  it('执行档里重跑计划模式的老消息：写工具仍然拒绝', async function () {
    await writeAgentMode('agent')
    expect(decideApprovalForThread('t-f013', WRITE_TOOL, options, 'plan')).toEqual({
      kind: 'deny',
      optionId: 'reject_once'
    })
  })
})
