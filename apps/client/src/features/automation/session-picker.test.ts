import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 选择器只存状态：把本机 store 的读库打桩，避免把 Tauri IPC 拉进单测
vi.mock('@/stores/agent', function () {
  return {
    useAgentStore: {
      getState: function () {
        return { sessions: [], workspaces: [], toReadSessions: async function () {} }
      }
    }
  }
})

import { useAutomationSessionPicker } from '@/features/automation/session-picker'

describe('执行前选择对话', function () {
  beforeEach(function () {
    vi.useFakeTimers()
  })

  afterEach(function () {
    vi.useRealTimers()
    useAutomationSessionPicker.setState({ request: null })
  })

  it('作答返回会话 id 并收起弹窗', async function () {
    const pending = useAutomationSessionPicker.getState().ask({ taskName: '日报', sessions: [] })
    expect(useAutomationSessionPicker.getState().request?.taskName).toBe('日报')
    useAutomationSessionPicker.getState().settle('sess-1')
    await expect(pending).resolves.toBe('sess-1')
    expect(useAutomationSessionPicker.getState().request).toBeNull()
  })

  it('关掉弹窗按新建对话收尾', async function () {
    const pending = useAutomationSessionPicker.getState().ask({ taskName: '日报', sessions: [] })
    useAutomationSessionPicker.getState().settle(null)
    await expect(pending).resolves.toBeNull()
    expect(useAutomationSessionPicker.getState().request).toBeNull()
  })

  it('无人应答超时后按新建对话继续', async function () {
    const pending = useAutomationSessionPicker.getState().ask({ taskName: '日报', sessions: [] })
    await vi.advanceTimersByTimeAsync(120_000)
    await expect(pending).resolves.toBeNull()
    expect(useAutomationSessionPicker.getState().request).toBeNull()
  })
})
