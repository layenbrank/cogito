/**
 * composer 撤销栈的纯逻辑。
 *
 * 断言的是「步数」而不是 DOM：DOM 每次都是重建的，能验证的只有快照序列本身。
 */
import { describe, expect, it } from 'vitest'

import { buildChip, parseDocument, serializeDocument } from './composer-document'
import { createComposerHistory, type ComposerHistoryEntry } from './composer-history'

function entry(text: string, cursor = text.length): ComposerHistoryEntry {
  return { atoms: parseDocument(text), cursor }
}

function textOf(snapshot: ComposerHistoryEntry | null): string | null {
  return snapshot ? serializeDocument(snapshot.atoms) : null
}

describe('composer 撤销栈', () => {
  it('两次离散操作后撤销，回到第一次之前的文档', function () {
    const history = createComposerHistory()
    const empty = entry('')
    const afterFirst = entry('第一段')

    // 「第一次操作前」与「第二次操作前」各入栈一次
    history.remember('discrete', empty, 1_000)
    history.remember('discrete', afterFirst, 2_000)

    expect(textOf(history.undo(entry('第一段第二段')))).toBe('第一段')
    expect(textOf(history.undo(entry('第一段')))).toBe('')
    // 栈空了就没有可撤销的
    expect(history.undo(entry(''))).toBeNull()
  })

  it('连续输入只产生一步', function () {
    const history = createComposerHistory()
    history.remember('typing', entry(''), 1_000)
    history.remember('typing', entry('a'), 1_100)
    history.remember('typing', entry('ab'), 1_200)
    history.remember('typing', entry('abc'), 1_300)

    expect(history.size().undo).toBe(1)
    expect(textOf(history.undo(entry('abcd')))).toBe('')
  })

  it('超过合并窗口的输入是新的一步', function () {
    const history = createComposerHistory()
    history.remember('typing', entry('a'), 1_000)
    history.remember('typing', entry('ab'), 1_100)
    // 600ms 后（>500ms）再敲，算新一步
    history.remember('typing', entry('abc'), 1_700)

    expect(history.size().undo).toBe(2)
    expect(textOf(history.undo(entry('abcd')))).toBe('abc')
  })

  it('离散操作不被连续输入吞掉（插 chip 后立刻删掉要能撤回到 chip 在的那一步）', function () {
    const history = createComposerHistory()
    const withChip = serializeDocument([buildChip('file', 'chat.tsx', 'apps/client/chat.tsx')])
    history.remember('typing', entry('hi'), 1_000)
    history.remember('discrete', entry(withChip), 1_050)

    expect(history.size().undo).toBe(2)
    expect(textOf(history.undo(entry('hi ')))).toBe(withChip)
  })

  it('撤销之后可以重做，新操作会作废重做栈', function () {
    const history = createComposerHistory()
    history.remember('discrete', entry('a'), 1_000)
    history.remember('discrete', entry('ab'), 2_000)

    const undone = history.undo(entry('abc'))
    expect(textOf(undone)).toBe('ab')
    expect(history.size().redo).toBe(1)
    expect(textOf(history.redo(entry('ab')))).toBe('abc')

    history.remember('discrete', entry('abc'), 3_000)
    expect(history.size().redo).toBe(0)
  })

  it('clear 之后撤销不会复活旧内容（发送 / 切会话的边界）', function () {
    const history = createComposerHistory()
    history.remember('discrete', entry('已经发出去的内容'), 1_000)
    history.clear()

    expect(history.size()).toEqual({ undo: 0, redo: 0 })
    expect(history.undo(entry(''))).toBeNull()
  })

  it('超出上限时丢最旧的一步', function () {
    const history = createComposerHistory({ limit: 2 })
    history.remember('discrete', entry('a'), 1_000)
    history.remember('discrete', entry('ab'), 2_000)
    history.remember('discrete', entry('abc'), 3_000)

    expect(history.size().undo).toBe(2)
    expect(textOf(history.undo(entry('abcd')))).toBe('abc')
    expect(textOf(history.undo(entry('abc')))).toBe('ab')
    expect(history.undo(entry('ab'))).toBeNull()
  })
})
