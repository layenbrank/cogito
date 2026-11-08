/**
 * 终端页签 store 的行为断言（跑的是**真 store**，不是 agent-tabs.test.ts 里的替身）。
 *
 * 钉的是「收起面板 / 会话退出 / 从 Rust list 灌回」三种迁移的边界 ——
 * 它们在 GUI 里的表现是「终端时不时不能用」「重开面板又冒出死会话」，
 * 现场基本抓不到，只能靠这一层守住（对应验证 #8 / #10 / #12 里能 headless 的部分）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(function () {
  return {
    kill: vi.fn(async function (_id: string) {
      /* noop */
    })
  }
})

vi.mock('@/lib/terminal', function () {
  return {
    Terminal: {
      kill: mocks.kill,
      attach: vi.fn(),
      create: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      list: vi.fn(async function () {
        return []
      }),
      resolveAgentId: vi.fn(),
      font: {}
    }
  }
})

import { useTerminalStore } from './terminal'

function reset(): void {
  useTerminalStore.setState({ tabs: [], activeId: null, open: false, activity: 'run' })
}

function firstTab() {
  return useTerminalStore.getState().tabs.at(0)
}

beforeEach(function () {
  reset()
  mocks.kill.mockClear()
})

describe('hydrateSession：从 Rust list 灌回会话', function () {
  it('已退出的 tab 只补 pid，绝不翻回运行态（否则「已退出」会消失、面板反复接管死会话）', function () {
    useTerminalStore.getState().newTab('C:/w')
    const id = firstTab()?.id ?? ''
    useTerminalStore.getState().markExited(id, 0)

    useTerminalStore.getState().hydrateSession({ id, cwd: 'C:/w', pid: 4242 })

    const tab = firstTab()
    expect(tab?.exited).toBe(true)
    expect(tab?.pid).toBe(4242)
    expect(tab?.restored).toBe(true)
  })

  it('已有 tab 不重复建（list 与 tabs 对齐靠它）', function () {
    useTerminalStore.getState().newTab('C:/w')
    const id = firstTab()?.id ?? ''
    useTerminalStore.getState().hydrateSession({ id, cwd: 'C:/w', pid: 1 })
    useTerminalStore.getState().hydrateSession({ id, cwd: 'C:/w', pid: 2 })
    expect(useTerminalStore.getState().tabs).toHaveLength(1)
    expect(firstTab()?.pid).toBe(2)
  })

  it('新 id 才建 tab；activeId 已失效时接管，避免面板空白', function () {
    useTerminalStore.getState().hydrateSession({ id: 'agent:C:/w', cwd: 'C:/w', pid: 7 })
    expect(useTerminalStore.getState().tabs).toHaveLength(1)
    expect(firstTab()?.origin).toBe('agent')
    expect(useTerminalStore.getState().activeId).toBe('agent:C:/w')
    expect(useTerminalStore.getState().open).toBe(false)
  })
})

describe('restoreAgentPanel：重开面板', function () {
  it('onlyIfHidden 时不抢用户当前页签', function () {
    useTerminalStore.getState().newTab('C:/mine')
    const mine = firstTab()?.id ?? ''
    useTerminalStore.getState().revealAgentTab({ id: 'agent:C:/w', cwd: 'C:/w', command: 'ls' })
    useTerminalStore.getState().writeActive(mine)

    useTerminalStore.getState().restoreAgentPanel({ onlyIfHidden: true })

    expect(useTerminalStore.getState().activeId).toBe(mine)
  })

  it('面板收起时掀开并接管 active', function () {
    useTerminalStore.getState().revealAgentTab({ id: 'agent:C:/w', cwd: 'C:/w', command: 'ls' })
    useTerminalStore.getState().closePanel()

    useTerminalStore.getState().restoreAgentPanel({ onlyIfHidden: true })

    expect(useTerminalStore.getState().open).toBe(true)
    expect(useTerminalStore.getState().activity).toBe('terminal')
    expect(useTerminalStore.getState().activeId).toBe('agent:C:/w')
  })

  it('没有任何 agent 会话时不动面板', function () {
    useTerminalStore.getState().newTab('C:/mine')
    useTerminalStore.getState().closePanel()

    useTerminalStore.getState().restoreAgentPanel()

    expect(useTerminalStore.getState().open).toBe(false)
  })
})

describe('revealAgentTab：会话隔离与复用', function () {
  it('同一 cwd 不同线程（id 带 #scope）各占一个 tab', function () {
    useTerminalStore.getState().revealAgentTab({ id: 'agent:C:/w#t1', cwd: 'C:/w', command: 'a' })
    useTerminalStore.getState().revealAgentTab({ id: 'agent:C:/w#t2', cwd: 'C:/w', command: 'b' })

    const ids = useTerminalStore.getState().tabs.map(function (tab) {
      return tab.id
    })
    expect(ids).toEqual(['agent:C:/w#t1', 'agent:C:/w#t2'])
    expect(useTerminalStore.getState().activeId).toBe('agent:C:/w#t2')
  })

  it('闲置退出后再来命令：同一个 id 复用并清掉 exited（会话被重新拉起）', function () {
    useTerminalStore.getState().revealAgentTab({ id: 'agent:C:/w', cwd: 'C:/w', command: 'a' })
    useTerminalStore.getState().markExited('agent:C:/w', null)

    useTerminalStore.getState().revealAgentTab({ id: 'agent:C:/w', cwd: 'C:/w', command: 'b' })

    expect(useTerminalStore.getState().tabs).toHaveLength(1)
    expect(firstTab()?.exited).toBe(false)
    expect(firstTab()?.command).toBe('b')
  })
})

describe('closePanel / closeAllSessions', function () {
  it('收起面板不杀会话：tabs 留着、进程不 kill', function () {
    useTerminalStore.getState().revealAgentTab({ id: 'agent:C:/w', cwd: 'C:/w', command: 'npm test' })

    useTerminalStore.getState().closePanel()

    expect(useTerminalStore.getState().open).toBe(false)
    expect(useTerminalStore.getState().tabs).toHaveLength(1)
    expect(mocks.kill).not.toHaveBeenCalled()
  })

  it('结束全部会话：逐个 kill 并清空 tabs', function () {
    useTerminalStore.getState().revealAgentTab({ id: 'agent:C:/w', cwd: 'C:/w', command: 'a' })
    useTerminalStore.getState().newTab('C:/mine')
    const expected = useTerminalStore.getState().tabs.map(function (tab) {
      return tab.id
    })

    useTerminalStore.getState().closeAllSessions()

    expect(mocks.kill.mock.calls.map(function (call) { return call[0] })).toEqual(expected)
    expect(useTerminalStore.getState().tabs).toHaveLength(0)
    expect(useTerminalStore.getState().activeId).toBeNull()
    expect(useTerminalStore.getState().open).toBe(false)
  })
})

describe('removeTab / markExited / writeActive', function () {
  it('删掉 active 时接管剩余 tab；删空后 activeId 为 null', function () {
    useTerminalStore.getState().newTab('C:/a')
    const a = firstTab()?.id ?? ''
    useTerminalStore.getState().newTab('C:/b')
    const b = useTerminalStore.getState().tabs.at(1)?.id ?? ''

    useTerminalStore.getState().removeTab(a)
    expect(useTerminalStore.getState().activeId).toBe(b)

    useTerminalStore.getState().removeTab(b)
    expect(useTerminalStore.getState().activeId).toBeNull()
  })

  it('markExited 只改该 tab 的状态，不动 active 与面板开关', function () {
    useTerminalStore.getState().newTab('C:/a')
    const a = firstTab()?.id ?? ''
    const openBefore = useTerminalStore.getState().open

    useTerminalStore.getState().markExited(a, 3)

    expect(firstTab()?.exited).toBe(true)
    expect(firstTab()?.exitCode).toBe(3)
    expect(useTerminalStore.getState().activeId).toBe(a)
    expect(useTerminalStore.getState().open).toBe(openBefore)
  })

  it('writeActive 只切 activeId，不碰 document.activeElement（store 层没有程序化 focus）', function () {
    useTerminalStore.getState().newTab('C:/a')
    const a = firstTab()?.id ?? ''
    const activeBefore = document.activeElement

    useTerminalStore.getState().writeActive(a)

    expect(useTerminalStore.getState().activeId).toBe(a)
    expect(document.activeElement).toBe(activeBefore)
  })
})
