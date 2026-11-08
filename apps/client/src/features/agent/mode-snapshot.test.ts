/**
 * 消息级模式快照：一条消息用哪个模式发的，重新生成就还用它。
 *
 * 复现的问题：目标模式跑一轮 → 意外停止 → 界面落回执行 → 用户切回目标 →
 * 点「重新生成」，发出去的提示却是执行模式。根因是模式只存在**会话偏好**里，
 * 发送那一刻现读；快照跟着消息走之后，重新生成复现的是当初那一次。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  MODE_SNAPSHOT_KEY,
  appendModeGuidance,
  buildModeSnapshot,
  findModeSnapshot,
  readAgentMode,
  readModeSnapshot,
  resolveModeFor,
  resolveRunMode,
  setAgentModeThread,
  stampModeSnapshot,
  writeAgentMode
} from '@/features/agent/mode'

function userMessage(mode?: string) {
  return {
    role: 'user' as const,
    content: '跑起来',
    metadata: mode
      ? ({ [MODE_SNAPSHOT_KEY]: { mode } } as Readonly<Record<string, unknown>>)
      : undefined
  }
}

/**
 * 业务侧只读 `role` + `metadata`；`content` 是测试的方便字段。
 * 这里给个具名构造函数，避免把带 `content` 的字面量直接喂进参数类型（多余属性检查会报 TS2353）。
 */
function plainMessage(role: string, content: string, metadata?: Readonly<Record<string, unknown>>) {
  return { role, content, metadata }
}

describe('消息级模式快照', function () {
  beforeEach(async function () {
    setAgentModeThread('t-snap')
    await writeAgentMode('agent')
  })

  it('发送时打快照：记下当时的模式与时间', async function () {
    await writeAgentMode('goal')
    const snapshot = buildModeSnapshot()
    expect(snapshot.mode).toBe('goal')
    expect(typeof snapshot.at).toBe('number')
  })

  it('重新生成：线程偏好已改成执行，消息快照仍是目标', async function () {
    await writeAgentMode('goal')
    const messages = [userMessage('goal')]
    // 用户中途切回执行（或目标轮次被停止后界面落回默认）
    await writeAgentMode('agent')
    expect(readAgentMode()).toBe('agent')

    const mode = resolveRunMode(messages)
    expect(mode).toBe('goal')
    expect(appendModeGuidance('系统提示', mode)).toContain('【目标模式】')
  })

  it('老数据（没有快照）回落会话偏好', async function () {
    await writeAgentMode('ask')
    expect(resolveRunMode([plainMessage('user', '旧消息')])).toBe('ask')
    expect(resolveModeFor(undefined)).toBe('ask')
  })

  it('快照形状不对时不认，回落会话偏好', async function () {
    await writeAgentMode('plan')
    const broken = { [MODE_SNAPSHOT_KEY]: { mode: 'turbo' } }
    expect(readModeSnapshot(broken)).toBeNull()
    expect(resolveRunMode([plainMessage('user', 'x', broken)])).toBe('plan')
  })

  it('取最后一条带快照的用户消息（助手消息不参与）', function () {
    const snapshot = findModeSnapshot([
      userMessage('goal'),
      plainMessage('assistant', '第一轮'),
      userMessage('plan')
    ])
    expect(snapshot?.mode).toBe('plan')
  })

  it('已有快照的消息不重打（历史重放 / 重新生成）', function () {
    const existing = { [MODE_SNAPSHOT_KEY]: { mode: 'goal', at: 1 }, usage: { totalTokens: 3 } }
    const stamped = stampModeSnapshot(existing)
    expect(stamped[MODE_SNAPSHOT_KEY]).toEqual({ mode: 'goal', at: 1 })
    // 其它扩展位原样保留
    expect(stamped.usage).toEqual({ totalTokens: 3 })
  })

  it('新消息打上当前模式，且不丢已有扩展位', async function () {
    await writeAgentMode('goal')
    const stamped = stampModeSnapshot({ orphanSource: 'background-turn' })
    expect(readModeSnapshot(stamped)?.mode).toBe('goal')
    expect(stamped.orphanSource).toBe('background-turn')
  })

  it('执行模式不追加任何约束', function () {
    expect(appendModeGuidance('原文', 'agent')).toBe('原文')
  })
})
