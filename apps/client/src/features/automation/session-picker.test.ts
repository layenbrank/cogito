import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 选择器只存状态：把本机 store 的读库打桩，避免把 Tauri IPC 拉进单测
const mock = vi.hoisted(function () {
  return {
    sessions: [] as Array<{
      id: string
      title: string
      workspaceID: string | null
      updatedAt: number
    }>,
    workspaces: [] as Array<{ id: string; title: string }>
  }
})

vi.mock('@/stores/agent', function () {
  return {
    useAgentStore: {
      getState: function () {
        return {
          sessions: mock.sessions,
          workspaces: mock.workspaces,
          toReadSessions: async function () {}
        }
      }
    }
  }
})

import {
  listPickableSessions,
  useAutomationSessionPicker
} from '@/features/automation/session-picker'

describe('执行前选择对话', function () {
  beforeEach(function () {
    vi.useFakeTimers()
    mock.sessions = []
    mock.workspaces = []
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

describe('listPickableSessions', function () {
  it('给了工作区就只列该工作区的对话，automation- 记录会话永远不出现', async function () {
    mock.workspaces = [{ id: 'ws-a', title: '项目 A' }]
    mock.sessions = [
      { id: 's1', title: 'A 的对话', workspaceID: 'ws-a', updatedAt: 3 },
      { id: 's2', title: 'B 的对话', workspaceID: 'ws-b', updatedAt: 2 },
      { id: 'automation-run-1', title: '任务记录', workspaceID: 'ws-a', updatedAt: 1 }
    ]

    const scoped = await listPickableSessions('ws-a')
    expect(
      scoped.map(function (item) {
        return item.id
      })
    ).toEqual(['s1'])
    expect(scoped[0].workspaceTitle).toBe('项目 A')

    // 没指定工作区（家目录任务）时保持全量
    const all = await listPickableSessions()
    expect(
      all.map(function (item) {
        return item.id
      })
    ).toEqual(['s1', 's2'])
  })
})
