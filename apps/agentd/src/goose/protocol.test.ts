import { describe, expect, it } from 'vitest'

import { createLineSplitter, parseMessage } from './protocol'

describe('createLineSplitter', function () {
  it('按 \\n 切分，丢弃空行，并容忍 CRLF', function () {
    const splitter = createLineSplitter()
    expect(splitter.push('{"a":1}\n\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('半行留到下一段（stdio 的 chunk 与行边界无关）', function () {
    const splitter = createLineSplitter()
    expect(splitter.push('{"partial')).toEqual([])
    expect(splitter.pending()).toBe('{"partial')
    expect(splitter.push('":true}\n')).toEqual(['{"partial":true}'])
    expect(splitter.pending()).toBe('')
  })

  it('一个 chunk 里多行一次吐出', function () {
    const splitter = createLineSplitter()
    expect(splitter.push('1\n2\n3\n')).toEqual(['1', '2', '3'])
  })
})

describe('parseMessage', function () {
  it('区分响应与通知', function () {
    expect(parseMessage('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}')).toMatchObject({ id: 7 })
    expect(parseMessage('{"jsonrpc":"2.0","method":"session/update","params":{}}')).toMatchObject({
      method: 'session/update'
    })
  })

  it('坏 JSON 返回 null，不抛', function () {
    expect(parseMessage('not json')).toBeNull()
    expect(parseMessage('{"no":"id"}')).toBeNull()
  })
})
