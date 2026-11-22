/**
 * SSE 读取的单元测试：前端两条订阅链路（发起一轮 / 恢复订阅）都走这一份实现。
 *
 * 重点锁两件事：跨 chunk 边界能拼回整帧；坏帧丢一条但不掐断整条流。
 */

import { describe, expect, it } from 'vitest'

import { readSse } from './sse'

function responseFrom(chunks: readonly string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start: function (controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(stream)
}

async function collect(response: Response, signal: AbortSignal) {
  const frames: Array<{ event: string; data: Record<string, unknown> }> = []
  for await (const frame of readSse(response, signal)) frames.push(frame)
  return frames
}

describe('readSse', function () {
  it('跨 chunk 边界能拼回整帧（帧边界是空行，不是换行）', async function () {
    const response = responseFrom([
      'event: run\ndata: {"seq":1,',
      '"kind":"update"}\n\nevent: sync\ndata: {"lastSeq":1}\n\n'
    ])
    const frames = await collect(response, new AbortController().signal)
    expect(frames).toEqual([
      { event: 'run', data: { seq: 1, kind: 'update' } },
      { event: 'sync', data: { lastSeq: 1 } }
    ])
  })

  it('坏 JSON 只丢这一帧，后续帧照常产出', async function () {
    const response = responseFrom([
      'event: run\ndata: {不是 JSON}\n\n',
      'event: run\ndata: {"seq":2}\n\n'
    ])
    const frames = await collect(response, new AbortController().signal)
    expect(frames).toEqual([{ event: 'run', data: { seq: 2 } }])
  })

  it('缺 `event:` 或 `data:` 的帧被忽略', async function () {
    const response = responseFrom(['data: {"seq":1}\n\n', 'event: run\ndata: {"seq":2}\n\n'])
    const frames = await collect(response, new AbortController().signal)
    expect(frames).toEqual([{ event: 'run', data: { seq: 2 } }])
  })

  it('signal 已中止时直接结束迭代，不抛错', async function () {
    const controller = new AbortController()
    controller.abort()
    const frames = await collect(responseFrom(['event: run\ndata: {"seq":1}\n\n']), controller.signal)
    expect(frames).toEqual([])
  })
})
