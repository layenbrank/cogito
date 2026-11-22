/**
 * 历史端口的单元测试（Dexie + fake-indexeddb）。
 *
 * 锁三件事：线程内消息顺序、会话排序（置顶 + 最近活动）、删会话时的级联。
 * 这三条错了界面上都不会报错，只会「消息倒序」「列表不动」「旧消息还在」。
 */

import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { database } from '@/database/database.ts'
import { buildDexieHistoryPort } from './history.ts'

const port = buildDexieHistoryPort()

beforeEach(async function () {
  await database.agentMessage.clear()
  await database.agentThread.clear()
})

describe('会话', function () {
  it('新会话用默认标题，并带续跑游标的初值', async function () {
    const thread = await port.createThread()
    expect(thread.title).toBe('新会话')
    expect(thread.pinned).toBe(false)
    expect(thread.providerID).toBeNull()
    const row = await database.agentThread.get(thread.id)
    expect(row?.lastSeq).toBe(0)
    expect(row?.acpSessionID).toBeNull()
  })

  it('置顶优先，其次按最近活动排序', async function () {
    const older = await port.createThread()
    const newer = await port.createThread()
    await port.updateThread(older.id, { title: '旧的' })
    // 手工压时间：`createThread` 连续两次可能落在同一毫秒
    await database.agentThread.update(older.id, { pinned: false, updatedAt: 1_000 })
    await database.agentThread.update(newer.id, { pinned: false, updatedAt: 2_000 })

    let threads = await port.findThreads()
    expect(threads.map(function (item) { return item.id })).toEqual([newer.id, older.id])

    await port.updateThread(older.id, { pinned: true })
    threads = await port.findThreads()
    expect(threads[0]?.id).toBe(older.id)
  })

  it('updateThread 不存在时抛错，而不是静默建一条空会话', async function () {
    await expect(port.updateThread('missing', { title: 'x' })).rejects.toThrow('会话不存在')
  })
})

describe('消息', function () {
  it('按插入顺序返回（同一毫秒也不会乱）', async function () {
    const thread = await port.createThread()
    await port.appendMessage({ threadID: thread.id, id: 'b', parentID: 'a', format: 'f', content: '2' })
    await port.appendMessage({ threadID: thread.id, id: 'a', parentID: null, format: 'f', content: '1' })
    await port.appendMessage({ threadID: thread.id, id: 'c', parentID: 'b', format: 'f', content: '3' })

    const messages = await port.findMessages({ threadID: thread.id })
    expect(messages.map(function (item) { return item.id })).toEqual(['b', 'a', 'c'])
  })

  it('appendMessage 会把会话的 updatedAt 顶上去（列表按它排「最近活动」）', async function () {
    const thread = await port.createThread()
    await database.agentThread.update(thread.id, { updatedAt: 1_000 })
    await port.appendMessage({ threadID: thread.id, id: 'm1', parentID: null, format: 'f', content: 'x' })
    const row = await database.agentThread.get(thread.id)
    expect(row?.updatedAt).toBeGreaterThan(1_000)
  })

  it('updateMessage 只改点名给的字段', async function () {
    const thread = await port.createThread()
    await port.appendMessage({ threadID: thread.id, id: 'm1', parentID: null, format: 'f', content: 'old' })
    await port.updateMessage({ id: 'm1', content: 'new' })
    const [message] = await port.findMessages({ threadID: thread.id })
    expect(message?.content).toBe('new')
    expect(message?.format).toBe('f')
  })

  it('deleteMessages 只删点名的 id，不猜分支', async function () {
    const thread = await port.createThread()
    await port.appendMessage({ threadID: thread.id, id: 'm1', parentID: null, format: 'f', content: '1' })
    await port.appendMessage({ threadID: thread.id, id: 'm2', parentID: 'm1', format: 'f', content: '2' })
    await port.deleteMessages({ ids: ['m1'] })
    const messages = await port.findMessages({ threadID: thread.id })
    expect(messages.map(function (item) { return item.id })).toEqual(['m2'])
  })
})

describe('删除会话', function () {
  it('连带删除该会话的消息，其它会话不动', async function () {
    const doomed = await port.createThread()
    const kept = await port.createThread()
    await port.appendMessage({ threadID: doomed.id, id: 'd1', parentID: null, format: 'f', content: 'x' })
    await port.appendMessage({ threadID: kept.id, id: 'k1', parentID: null, format: 'f', content: 'y' })

    await port.deleteThread(doomed.id)

    expect(await port.findThread(doomed.id)).toBeNull()
    expect(await port.findMessages({ threadID: doomed.id })).toEqual([])
    expect((await port.findMessages({ threadID: kept.id })).length).toBe(1)
  })
})
