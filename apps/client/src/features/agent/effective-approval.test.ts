import { beforeEach, describe, expect, it } from 'vitest'

import { writeApprovalModeFor } from '@/features/agent/approval'
import { findEffectiveApprovalMode } from '@/features/agent/effective-approval'
import { writeAgentMode } from '@/features/agent/mode'
import { setAgentModeThread } from '@/features/agent/mode'
import { isWriteTool } from '@/features/agent/approval'

describe('有效审批档', function () {
  beforeEach(async function () {
    setAgentModeThread('t-eff')
    writeApprovalModeFor('t-eff', 'ask')
    await writeAgentMode('agent')
  })

  it('计划模式覆盖为 readonly，不看用户偏好', async function () {
    await writeAgentMode('plan')
    expect(findEffectiveApprovalMode('t-eff')).toBe('readonly')
    expect(findEffectiveApprovalMode('t-eff', 'auto')).toBe('auto')
  })

  it('执行模式用会话审批偏好', async function () {
    await writeAgentMode('agent')
    writeApprovalModeFor('t-eff', 'ask')
    expect(findEffectiveApprovalMode('t-eff')).toBe('ask')
  })

  it('写工具名分类：text_editor / shell 为写，read_file 为读', function () {
    expect(isWriteTool('text_editor')).toBe(true)
    expect(isWriteTool('shell')).toBe(true)
    expect(isWriteTool('read_file')).toBe(false)
  })
})
