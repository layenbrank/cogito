import { describe, expect, it, vi } from 'vitest'
import type {
  CreateElicitationRequest,
  RequestPermissionRequest,
  SessionUpdate
} from '@agentclientprotocol/sdk'

import {
  parseAcpApprovalRequest,
  parseAcpElicitationRequest,
  parseAcpElicitationResponse,
  parseAcpPermissionOutcome,
  parseAcpStreamEvent,
  type AcpStreamContext
} from '@/features/agent/acp/stream.ts'

/**
 * 映射表的账：一次 update 要么产出一条事件，要么明确不产出（null）。
 * goose 换字段时这里应该先红，而不是 UI 上悄悄少一段文字。
 */

function createContext(): AcpStreamContext & { usage: unknown[] } {
  const usage: unknown[] = []
  return {
    usage,
    blockID: function (messageId, kind) {
      return messageId ? `${kind}:${messageId}` : `${kind}:auto`
    },
    onContextUsage: function (value) {
      usage.push(value)
    }
  }
}

describe('parseAcpStreamEvent', function () {
  it('把文本与推理增量按 messageId 归组', function () {
    const context = createContext()

    expect(
      parseAcpStreamEvent(
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'm1',
          content: { type: 'text', text: '你好' }
        } as SessionUpdate,
        context
      )
    ).toEqual({ kind: 'text', blockID: 'text:m1', text: '你好' })

    expect(
      parseAcpStreamEvent(
        {
          sessionUpdate: 'agent_thought_chunk',
          messageId: 'm1',
          content: { type: 'text', text: '想一下' }
        } as SessionUpdate,
        context
      )
    ).toEqual({ kind: 'reasoning', blockID: 'reasoning:m1', text: '想一下' })

    // 没有 messageId 时由外部兜底（同一段继续追加）
    expect(
      parseAcpStreamEvent(
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '续' } } as SessionUpdate,
        context
      )
    ).toEqual({ kind: 'text', blockID: 'text:auto', text: '续' })
  })

  it('非文本块与空文本不产出事件', function () {
    const context = createContext()

    expect(
      parseAcpStreamEvent(
        { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'x', mimeType: 'image/png' } } as SessionUpdate,
        context
      )
    ).toBeNull()
    expect(
      parseAcpStreamEvent(
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '' } } as SessionUpdate,
        context
      )
    ).toBeNull()
  })

  it('tool_call 取程序名（name 优先，回退 title）与原始入参', function () {
    const context = createContext()

    expect(
      parseAcpStreamEvent(
        {
          sessionUpdate: 'tool_call',
          toolCallId: 't1',
          name: 'read_file',
          title: '读取 config.yaml',
          rawInput: { path: 'config.yaml' }
        } as SessionUpdate,
        context
      )
    ).toEqual({
      kind: 'tool-call',
      toolCallId: 't1',
      toolName: 'read_file',
      input: { path: 'config.yaml' }
    })

    expect(
      parseAcpStreamEvent(
        { sessionUpdate: 'tool_call', toolCallId: 't2', title: '跑一下' } as SessionUpdate,
        context
      )
    ).toEqual({ kind: 'tool-call', toolCallId: 't2', toolName: '跑一下', input: null })
  })

  it('tool_call_update 只在终态产出结果，失败标记 isError', function () {
    const context = createContext()

    expect(
      parseAcpStreamEvent(
        { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' } as SessionUpdate,
        context
      )
    ).toBeNull()

    expect(
      parseAcpStreamEvent(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed',
          rawOutput: { ok: true }
        } as SessionUpdate,
        context
      )
    ).toEqual({
      kind: 'tool-result',
      toolCallId: 't1',
      toolName: 'tool',
      output: { ok: true },
      isError: false
    })

    expect(
      parseAcpStreamEvent(
        { sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed' } as SessionUpdate,
        context
      )
    ).toEqual({
      kind: 'tool-result',
      toolCallId: 't2',
      toolName: 'tool',
      output: null,
      isError: true
    })
  })

  it('计划整份替换，命令与模式各自成事件', function () {
    const context = createContext()

    expect(
      parseAcpStreamEvent(
        {
          sessionUpdate: 'plan',
          entries: [
            { content: '读代码', status: 'completed', priority: 'high' },
            { content: '改代码' }
          ]
        } as SessionUpdate,
        context
      )
    ).toEqual({
      kind: 'plan',
      entries: [{ content: '读代码', status: 'completed', priority: 'high' }, { content: '改代码' }]
    })

    expect(
      parseAcpStreamEvent(
        {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'compact', description: '压缩上下文' }]
        } as SessionUpdate,
        context
      )
    ).toEqual({ kind: 'commands-update', commands: [{ name: 'compact', description: '压缩上下文' }] })

    expect(
      parseAcpStreamEvent({ sessionUpdate: 'current_mode_update', currentModeId: 'approve' } as SessionUpdate, context)
    ).toEqual({ kind: 'mode-update', mode: 'approve' })
    // 认不出的档位不猜
    expect(
      parseAcpStreamEvent({ sessionUpdate: 'current_mode_update', currentModeId: 'yolo' } as SessionUpdate, context)
    ).toBeNull()
  })

  it('usage_update 走回调而不是事件流', function () {
    const context = createContext()

    expect(
      parseAcpStreamEvent({ sessionUpdate: 'usage_update', used: 12_000, size: 128_000 } as SessionUpdate, context)
    ).toBeNull()
    expect(context.usage).toEqual([{ used: 12_000, size: 128_000 }])
  })

  it('本地已回显 / 无关的种类一律不产出事件', function () {
    const context = createContext()

    expect(
      parseAcpStreamEvent(
        { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '我' } } as SessionUpdate,
        context
      )
    ).toBeNull()
    expect(
      parseAcpStreamEvent({ sessionUpdate: 'session_info_update', title: '新标题' } as SessionUpdate, context)
    ).toBeNull()
  })
})

describe('parseAcpApprovalRequest', function () {
  it('选项类别从 snake_case 换成连字符，并带上人话提示', function () {
    const params = {
      sessionId: 's1',
      toolCall: { toolCallId: 't1', name: 'write_file', title: '写入 a.ts', rawInput: { path: 'a.ts' } },
      options: [
        { optionId: 'o1', name: '允许一次', kind: 'allow_once' },
        { optionId: 'o2', name: '总是允许', kind: 'allow_always' },
        { optionId: 'o3', name: '拒绝', kind: 'reject_once' }
      ]
    } as unknown as RequestPermissionRequest

    expect(parseAcpApprovalRequest(params)).toEqual({
      kind: 'tool-approval-request',
      toolCallId: 't1',
      toolName: 'write_file',
      input: { path: 'a.ts' },
      prompt: '写入 a.ts',
      options: [
        { id: 'o1', kind: 'allow-once', label: '允许一次' },
        { id: 'o2', kind: 'allow-always', label: '总是允许' },
        { id: 'o3', kind: 'reject-once', label: '拒绝' }
      ]
    })
  })

  it('未知类别按「拒绝一次」兜底，不丢选项也不放大权限', function () {
    const params = {
      sessionId: 's1',
      toolCall: { toolCallId: 't1' },
      options: [{ optionId: 'o9', name: '将来才有的选项', kind: 'brand_new_kind' }]
    } as unknown as RequestPermissionRequest

    const event = parseAcpApprovalRequest(params)
    expect(event).toMatchObject({
      kind: 'tool-approval-request',
      toolName: 'tool',
      options: [{ id: 'o9', kind: 'reject-once', label: '将来才有的选项' }]
    })
  })
})

describe('parseAcpPermissionOutcome', function () {
  const options = [
    { id: 'o1', kind: 'allow-once' },
    { id: 'o2', kind: 'allow-always' },
    { id: 'o3', kind: 'reject-once' }
  ] as const

  it('明确选了某项就用它', function () {
    expect(parseAcpPermissionOutcome({ toolCallId: 't1', approved: true, optionId: 'o3' }, options)).toEqual({
      outcome: 'selected',
      optionId: 'o3'
    })
  })

  it('optionId 不在本次 options 内则取消', function () {
    expect(parseAcpPermissionOutcome({ toolCallId: 't1', approved: true, optionId: 'forged' }, options)).toEqual({
      outcome: 'cancelled'
    })
  })

  it('只给「允许 / 拒绝」时按类别顺序挑', function () {
    expect(parseAcpPermissionOutcome({ toolCallId: 't1', approved: true }, options)).toEqual({
      outcome: 'selected',
      optionId: 'o1'
    })
    expect(parseAcpPermissionOutcome({ toolCallId: 't1', approved: false }, options)).toEqual({
      outcome: 'selected',
      optionId: 'o3'
    })
  })

  it('挑不出对应类别才退回 cancelled（不硬造 optionId）', function () {
    expect(parseAcpPermissionOutcome({ toolCallId: 't1', approved: true }, [{ id: 'o3', kind: 'reject-once' }])).toEqual({
      outcome: 'cancelled'
    })
  })
})

describe('追问（elicitation）', function () {
  it('form 模式摊平成字段表，required 逐字段标注', function () {
    const request = {
      mode: 'form',
      sessionId: 's1',
      requestedSchema: {
        type: 'object',
        title: '补充信息',
        description: '填完继续',
        required: ['name'],
        properties: {
          name: { type: 'string', description: '姓名', minLength: 2 },
          level: { type: 'string', oneOf: [{ const: 'a', title: '甲' }, { const: 'b', title: '乙' }] },
          count: { type: 'integer', minimum: 1, maximum: 9, default: 3 },
          agree: { type: 'boolean', default: true }
        }
      }
    } as unknown as CreateElicitationRequest

    expect(parseAcpElicitationRequest(request)).toEqual({
      prompt: '补充信息',
      schema: {
        title: '补充信息',
        description: '填完继续',
        fields: [
          { name: 'name', type: 'string', description: '姓名', minLength: 2, required: true },
          { name: 'level', type: 'string', enumValues: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }] },
          { name: 'count', type: 'integer', minimum: 1, maximum: 9, default: 3 },
          { name: 'agree', type: 'boolean', default: true }
        ]
      }
    })
  })

  it('url 模式不当作表单（另有交互）', function () {
    const request = { mode: 'url', sessionId: 's1', elicitationId: 'e1', url: 'https://x' } as unknown as CreateElicitationRequest

    expect(parseAcpElicitationRequest(request)).toBeNull()
  })

  it('回执：cancel 不带内容，accept 补空对象', function () {
    expect(parseAcpElicitationResponse({ elicitationId: 'e1', action: 'cancel' })).toEqual({ action: 'cancel' })
    expect(parseAcpElicitationResponse({ elicitationId: 'e1', action: 'accept', content: { a: 1 } })).toEqual({
      action: 'accept',
      content: { a: 1 }
    })
    expect(parseAcpElicitationResponse({ elicitationId: 'e1', action: 'accept' })).toEqual({
      action: 'accept',
      content: {}
    })
  })
})

describe('上下文用量回调是可选的', function () {
  it('没给回调也不报错', function () {
    const spy = vi.fn()
    const context: AcpStreamContext = { blockID: spy }
    expect(
      parseAcpStreamEvent({ sessionUpdate: 'usage_update', used: 1, size: 2 } as SessionUpdate, context)
    ).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
