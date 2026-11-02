import type { ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import { findRunningCommands, isRunningToolPart } from '@/features/agent/running-commands'

function toolCall(
  toolCallId: string,
  args: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
  return { type: 'tool-call', toolCallId, toolName: 'shell', args, argsText: '', ...extra }
}

function assistant(...content: unknown[]): ThreadMessage {
  return { role: 'assistant', content } as unknown as ThreadMessage
}

describe('正在执行的命令', function () {
  it('没有结果、且参数里有命令的 tool-call 才算执行中', function () {
    const messages = [
      assistant(
        toolCall('a', { command: 'npm run build' }),
        toolCall('b', { command: 'ls' }, { result: 'ok' }),
        toolCall('c', { path: 'src/a.ts' })
      )
    ]
    expect(findRunningCommands(messages)).toEqual([
      { toolCallId: 'a', command: 'npm run build', workdir: null, background: false }
    ])
  })

  it('带 workdir 与 background 原样带出', function () {
    const messages = [
      assistant(toolCall('a', { command: 'npm run dev', workdir: 'apps/client', background: true }))
    ]
    expect(findRunningCommands(messages)[0]).toMatchObject({
      workdir: 'apps/client',
      background: true
    })
  })

  it('等审批 / 等人工回答不算执行中', function () {
    expect(isRunningToolPart(toolCall('a', { command: 'ls' }) as never)).toBe(true)
    expect(
      isRunningToolPart(toolCall('a', { command: 'ls' }, { approval: { id: 'x' } }) as never)
    ).toBe(false)
    expect(
      isRunningToolPart(
        toolCall('a', { command: 'ls' }, { approval: { id: 'x', approved: true } }) as never
      )
    ).toBe(true)
    expect(
      isRunningToolPart(
        toolCall('a', { command: 'ls' }, { interrupt: { type: 'human', payload: {} } }) as never
      )
    ).toBe(false)
  })

  it('流式中间态结果仍算执行中', function () {
    expect(
      isRunningToolPart(
        toolCall('a', { command: 'ls' }, { result: 'partial', isPreliminary: true }) as never
      )
    ).toBe(true)
  })
})
