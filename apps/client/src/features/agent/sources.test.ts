import type { ThreadMessage } from '@assistant-ui/react'
import { describe, expect, it } from 'vitest'

import { collectSources, groupSources, isReadTool } from './sources'

const TAB = 'browser-a6141a05-e1a5-46a6-a1b8-bf2d56fd1349'

function message(
  id: string,
  role: 'user' | 'assistant',
  content: readonly unknown[]
): ThreadMessage {
  return {
    id,
    role,
    content,
    createdAt: new Date(0),
    status: { type: 'complete', reason: 'unknown' }
  } as unknown as ThreadMessage
}

function userText(id: string, text: string): ThreadMessage {
  return message(id, 'user', [{ type: 'text', text }])
}

function toolCall(
  toolName: string,
  args: Record<string, unknown>
): ThreadMessage['content'][number] {
  return {
    type: 'tool-call',
    toolCallId: `${toolName}-1`,
    toolName,
    args,
    status: { type: 'complete' }
  } as unknown as ThreadMessage['content'][number]
}

describe('collectSources', function () {
  it('把用户正文里的 @ 引用解析成来源（含文件夹与标签页）', function () {
    const sources = collectSources({
      messages: [userText('u1', '看下 @apps/client/src/chat.tsx 和 @apps/api，再对着 @' + TAB)],
      attachmentNames: [],
      rootPath: null
    })
    expect(sources.map((source) => source.id)).toEqual([
      'apps/client/src/chat.tsx',
      'apps/api',
      TAB
    ])
    expect(sources.map((source) => source.kind)).toEqual(['file', 'file', 'browser'])
    expect(sources.every((source) => source.usage === 'referenced')).toBe(true)
  })

  it('装饰性写法不当来源：@media 是普通文本', function () {
    const media = collectSources({
      messages: [userText('u1', '这段 @media 怎么写')],
      attachmentNames: [],
      rootPath: null
    })
    expect(media).toHaveLength(0)
  })

  it('含 / 的写法与 composer 同规则：@types/react 仍算 chip', function () {
    const scoped = collectSources({
      messages: [userText('u1', '看 @types/react')],
      attachmentNames: [],
      rootPath: null
    })
    expect(scoped.map((source) => source.id)).toEqual(['types/react'])
  })

  it('附件行与消息里的 file / image part 都算附件', function () {
    const sources = collectSources({
      messages: [
        message('u1', 'user', [
          { type: 'text', text: '看图' },
          { type: 'file', filename: 'src/a.png' },
          { type: 'image', image: 'data:image/png;base64,xx', filename: 'shot.png' }
        ])
      ],
      attachmentNames: ['pasted.ts'],
      rootPath: null
    })
    expect(sources.map((source) => source.id)).toEqual(['pasted.ts', 'src/a.png', 'shot.png'])
    expect(sources.every((source) => source.usage === 'attached')).toBe(true)
  })

  it('只把读类工具算作「读取」，写 / 改工具不算', function () {
    const sources = collectSources({
      messages: [
        message('a1', 'assistant', [
          toolCall('read_file', { path: 'src/a.ts' }),
          toolCall('developer__text_editor', { command: 'view', path: 'src/b.ts' }),
          toolCall('developer__text_editor', { command: 'str_replace', path: 'src/c.ts' }),
          toolCall('write_file', { path: 'src/d.ts' }),
          toolCall('shell', { command: 'cat src/e.ts' })
        ])
      ],
      attachmentNames: [],
      rootPath: null
    })
    expect(sources.map((source) => source.id)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(sources.every((source) => source.usage === 'read')).toBe(true)
  })

  it('同一文件被引用又被读过时只留一条，且引用优先', function () {
    const sources = collectSources({
      messages: [
        userText('u1', '看 @src/a.ts'),
        message('a1', 'assistant', [toolCall('read_file', { path: 'src/a.ts' })])
      ],
      attachmentNames: [],
      rootPath: null
    })
    expect(sources).toHaveLength(1)
    expect(sources[0].usage).toBe('referenced')
  })

  it('按引用 → 附件 → 读取排序，并遵守 limit', function () {
    const sources = collectSources({
      messages: [
        userText('u1', '看 @src/a.ts'),
        message('u2', 'user', [{ type: 'file', filename: 'src/paste.md' }]),
        message('a1', 'assistant', [toolCall('read_file', { path: 'src/b.ts' })])
      ],
      attachmentNames: [],
      rootPath: null,
      limit: 2
    })
    expect(sources.map((source) => source.usage)).toEqual(['referenced', 'attached'])
  })

  it('相对路径归一：反斜杠与 ./ 前缀被抹平', function () {
    const sources = collectSources({
      messages: [message('a1', 'assistant', [toolCall('read_file', { path: './src\\win.ts' })])],
      attachmentNames: [],
      rootPath: null
    })
    expect(sources.map((source) => source.id)).toEqual(['src/win.ts'])
    expect(sources[0].relative).toBe('src/win.ts')
  })
})

describe('isReadTool', function () {
  it('读类命中、写类与终端不命中', function () {
    expect(isReadTool('read_file', {})).toBe(true)
    expect(isReadTool('filesystem__read_text_file', {})).toBe(true)
    expect(isReadTool('text_editor', { command: 'view' })).toBe(true)
    expect(isReadTool('text_editor', { command: 'create' })).toBe(false)
    expect(isReadTool('shell', {})).toBe(false)
    expect(isReadTool('write_file', {})).toBe(false)
  })
})

describe('groupSources', function () {
  it('只保留非空分组，顺序固定 引用 / 附件 / 读取', function () {
    const sources = collectSources({
      messages: [
        message('a1', 'assistant', [toolCall('read_file', { path: 'src/b.ts' })]),
        userText('u1', '看 @src/a.ts')
      ],
      attachmentNames: [],
      rootPath: null
    })
    expect(groupSources(sources).map((group) => group.usage)).toEqual(['referenced', 'read'])
    expect(groupSources(sources).map((group) => group.label)).toEqual(['引用', '读取'])
    expect(groupSources([])).toHaveLength(0)
  })
})
