import { describe, expect, it, vi, beforeEach } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', function () {
  return { invoke }
})

import {
  __resetBindingCache,
  bindSession,
  preloadBindings,
  readBinding,
  recallBinding,
  unbindSession
} from '@/features/agent/acp/session-binding'

const row = {
  sessionId: 's1',
  acpSessionId: 'acp-1',
  cwd: 'C:\\repo',
  lastSeq: 7,
  routeTier: 'local'
}

describe('会话 ↔ ACP 绑定（S9）', function () {
  beforeEach(function () {
    invoke.mockReset()
    __resetBindingCache()
  })

  it('预载会把全量绑定灌进缓存，之后同步可读', async function () {
    invoke.mockResolvedValueOnce([row])
    await expect(preloadBindings()).resolves.toBe(1)
    expect(recallBinding('s1')).toEqual({
      acpSessionId: 'acp-1',
      cwd: 'C:\\repo',
      lastSeq: 7,
      routeTier: 'local'
    })
    // 带空白也要能命中（调用方的 id 常来自 UI，夹带空格）
    expect(recallBinding(' s1 ')).not.toBeNull()
    expect(recallBinding('s2')).toBeNull()
  })

  it('绑定成功后写缓存，并把 trim 过的 id 传给 Rust', async function () {
    invoke.mockResolvedValueOnce({
      acpSessionId: 'acp-9',
      cwd: '/tmp',
      lastSeq: 0,
      routeTier: 'local'
    })
    const binding = await bindSession(' s1 ', { acpSessionId: ' acp-9 ', cwd: '/tmp' })
    expect(binding?.acpSessionId).toBe('acp-9')
    expect(invoke).toHaveBeenCalledWith('agentSession:bindAcp', {
      params: { sessionId: 's1', acpSessionId: ' acp-9 ', cwd: '/tmp' }
    })
    expect(recallBinding('s1')?.acpSessionId).toBe('acp-9')
  })

  it('空 id 直接放弃，不打扰 Rust', async function () {
    expect(await bindSession('s1', { acpSessionId: '   ' })).toBeNull()
    expect(await bindSession('   ', { acpSessionId: 'acp-1' })).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('Rust 侧报错（会话不存在）只降级，不抛给调用方', async function () {
    invoke.mockRejectedValueOnce(new Error('未找到：agent_session not found: ghost'))
    const binding = await bindSession('ghost', { acpSessionId: 'acp-1' })
    expect(binding).toBeNull()
    expect(recallBinding('ghost')).toBeNull()
  })

  it('读库：没绑过（null）返回 null；读到就写缓存', async function () {
    invoke.mockResolvedValueOnce(null)
    expect(await readBinding('s1')).toBeNull()

    invoke.mockResolvedValueOnce({
      acpSessionId: 'acp-2',
      cwd: '/repo',
      lastSeq: 3,
      routeTier: 'cloud'
    })
    expect((await readBinding('s1'))?.acpSessionId).toBe('acp-2')
    // 第二次走缓存，不再打命令
    expect((await readBinding('s1'))?.acpSessionId).toBe('acp-2')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('预载失败按「都没绑过」处理，不让启动挂掉', async function () {
    invoke.mockRejectedValueOnce(new Error('bridge down'))
    await expect(preloadBindings()).resolves.toBe(0)
    expect(recallBinding('s1')).toBeNull()
  })

  it('解绑先清缓存再通知 Rust，失败也不抛', async function () {
    invoke.mockResolvedValueOnce([row])
    await preloadBindings()
    expect(recallBinding('s1')).not.toBeNull()

    invoke.mockResolvedValueOnce(true)
    await expect(unbindSession(' s1 ')).resolves.toBe(true)
    expect(invoke).toHaveBeenLastCalledWith('agentSession:unbindAcp', {
      params: { sessionId: 's1' }
    })
    // 缓存已经清掉：恢复路径不该再拿到这个死 sessionID
    expect(recallBinding('s1')).toBeNull()

    invoke.mockRejectedValueOnce(new Error('db locked'))
    await expect(unbindSession('s1')).resolves.toBe(false)
    expect(recallBinding('s1')).toBeNull()
  })
})
