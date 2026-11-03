import type { ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import {
  findRunningCommands,
  findSessionCommands,
  isRunningToolPart
} from '@/features/agent/running-commands'

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
      {
        toolCallId: 'a',
        command: 'npm run build',
        workdir: null,
        background: false,
        status: 'running',
        source: 'external'
      }
    ])
  })

  it('app_terminal_* 标为 panel，goose shell 标为 external', function () {
    const messages = [
      assistant(
        { type: 'tool-call', toolCallId: 'p', toolName: 'app_terminal_run', args: { command: 'ls' }, argsText: '' },
        toolCall('e', { command: 'pwd' })
      )
    ]
    expect(findSessionCommands(messages).map(function (command) {
      return `${command.toolCallId}:${command.source}`
    })).toEqual(['p:panel', 'e:external'])
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

describe('会话命令长显', function () {
  it('完成与失败的命令也保留在列表里', function () {
    const messages = [
      assistant(
        toolCall('a', { command: 'npm run build' }),
        toolCall('b', { command: 'ls' }, { result: 'ok' }),
        toolCall('c', { command: 'false' }, { result: 'err', isError: true }),
        toolCall('d', { path: 'src/a.ts' })
      )
    ]
    expect(findSessionCommands(messages).map(function (command) {
      return `${command.toolCallId}:${command.status}`
    })).toEqual(['a:running', 'b:done', 'c:error'])
  })

  it('等待审批标记为 waiting', function () {
    const messages = [
      assistant(toolCall('a', { command: 'rm -rf /' }, { approval: { id: 'x' } }))
    ]
    expect(findSessionCommands(messages)[0]?.status).toBe('waiting')
    expect(findRunningCommands(messages)).toEqual([])
  })
})
