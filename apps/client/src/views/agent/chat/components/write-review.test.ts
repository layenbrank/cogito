/**
 * 写工具卡「按块审阅」的纯逻辑：切块、范围标记、按决定合成正文。
 *
 * 这里不覆盖「能不能落盘」——那一步要和磁盘现状比对，属于组件里的动作
 * （片段级 old_string / new_string 也会切出块，只是落盘前会被拒掉）。
 */
import { describe, expect, it } from 'vitest'

import {
  isSameText,
  parsePatchReview,
  parseWriteReview,
  rebuildPatchText,
  rebuildReviewedText
} from './write-review'

function numberLines(count: number) {
  const lines: string[] = []
  for (let index = 1; index <= count; index += 1) {
    lines.push(`line${index}`)
  }
  return lines.join('\n')
}

function replaceLine(text: string, index: number, next: string) {
  const lines = text.split('\n')
  lines[index] = next
  return lines.join('\n')
}

const BEFORE = numberLines(20)
/** 第 2 行与第 17 行各改一处，块之间隔得够远 */
const AFTER = replaceLine(replaceLine(BEFORE, 1, 'line2-fixed'), 16, 'line17-fixed')

describe('parseWriteReview', function () {
  it('without before/after returns null', function () {
    expect(parseWriteReview({ path: 'a.ts', content: 'one\ntwo' })).toBeNull()
  })

  it('片段级 old_string / new_string 不走整文件审阅（拿去重建会把文件写成那一段）', function () {
    expect(
      parseWriteReview({ path: 'a.ts', old_string: 'alpha', new_string: 'beta' })
    ).toBeNull()
  })

  it('returns null when nothing changed', function () {
    expect(parseWriteReview({ path: 'a.ts', before: 'a\nb', after: 'a\nb' })).toBeNull()
  })

  it('splits distant changes into separate hunks', function () {
    const review = parseWriteReview({ path: 'src/a.ts', before: BEFORE, after: AFTER })

    expect(review?.fileName).toBe('a.ts')
    expect(review?.hunks).toHaveLength(2)
    expect(review?.hunks[0].range.startsWith('@@ -1,')).toBe(true)
    expect(review?.hunks[1].range.startsWith('@@ -14,')).toBe(true)
    // 改动落在第 2 行，前面只剩 1 行上下文：本块共 1 + 2 + 3 行
    expect(review?.hunks[0].lines).toHaveLength(6)
  })

  it('merges nearby changes into one hunk', function () {
    const after = replaceLine(replaceLine(BEFORE, 1, 'line2-fixed'), 4, 'line5-fixed')
    const review = parseWriteReview({ path: 'a.ts', before: BEFORE, after })

    expect(review?.hunks).toHaveLength(1)
  })
})

describe('rebuildReviewedText', function () {
  it('keeps everything when no hunk was discarded', function () {
    const review = parseWriteReview({ path: 'a.ts', before: BEFORE, after: AFTER })
    if (!review) throw new Error('review should exist')

    const decisions = Object.fromEntries(
      review.hunks.map(function (hunk) {
        return [hunk.id, 'kept' as const]
      })
    )
    expect(rebuildReviewedText(review, decisions)).toBe(AFTER)
  })

  it('falls back to the before side when every hunk is discarded', function () {
    const review = parseWriteReview({ path: 'a.ts', before: BEFORE, after: AFTER })
    if (!review) throw new Error('review should exist')

    const decisions = Object.fromEntries(
      review.hunks.map(function (hunk) {
        return [hunk.id, 'discarded' as const]
      })
    )
    expect(rebuildReviewedText(review, decisions)).toBe(BEFORE)
  })

  it('applies only the kept hunk', function () {
    const review = parseWriteReview({ path: 'a.ts', before: BEFORE, after: AFTER })
    if (!review) throw new Error('review should exist')

    const text = rebuildReviewedText(review, {
      [review.hunks[0].id]: 'kept',
      [review.hunks[1].id]: 'discarded'
    })
    expect(text).toContain('line2-fixed')
    expect(text).not.toContain('line17-fixed')
    expect(text).toContain('line17')
  })

  it('treats a pending hunk as kept, so nothing is lost by accident', function () {
    const review = parseWriteReview({ path: 'a.ts', before: BEFORE, after: AFTER })
    if (!review) throw new Error('review should exist')

    const text = rebuildReviewedText(review, {})
    expect(text).toBe(AFTER)
  })

  it('keeps the trailing newline of the after text', function () {
    const before = numberLines(5) + '\n'
    const review = parseWriteReview({
      path: 'a.ts',
      before,
      after: before.replace('line3', 'line3-fixed')
    })
    if (!review) throw new Error('review should exist')

    expect(rebuildReviewedText(review, {}).endsWith('line5\n')).toBe(true)
  })

  it('keeps CRLF line endings', function () {
    const before = numberLines(5).replace(/\n/g, '\r\n') + '\r\n'
    const after = before.replace('line3', 'line3-fixed')
    const review = parseWriteReview({ path: 'a.ts', before, after })
    if (!review) throw new Error('review should exist')

    expect(review.eol).toBe('\r\n')
    const text = rebuildReviewedText(review, {})
    expect(text).toBe(after)
    expect(text.includes('\n\n')).toBe(false)
  })
})

describe('定点替换（cogito_workspace_patch）的逐段审阅', function () {
  const ARGS = {
    path: 'src/a.ts',
    edits: [
      { oldText: 'alpha', newText: 'alpha-2' },
      { oldText: 'beta', newText: 'beta-2' }
    ]
  }

  it('一段改动就是一块，没有整文件 before 也能审阅', function () {
    const review = parsePatchReview(ARGS)
    expect(review?.fileName).toBe('a.ts')
    expect(review?.hunks.map(function (hunk) {
      return hunk.id
    })).toEqual(['edit-0', 'edit-1'])
  })

  it('不是 edits[] 形态就不走这条（交给整文件审阅）', function () {
    expect(parsePatchReview({ path: 'a.ts', before: 'a', after: 'b' })).toBeNull()
    expect(parsePatchReview({ path: 'a.ts', content: 'one' })).toBeNull()
  })

  it('goose edit 的 old_string / new_string 也能逐段审阅', function () {
    const review = parsePatchReview({ path: 'a.ts', old_string: 'alpha', new_string: 'beta' })
    expect(review?.hunks).toHaveLength(1)
    expect(review?.hunks[0].before).toBe('alpha')
    expect(review?.hunks[0].after).toBe('beta')
  })

  it('丢弃的段反向还原，保留的段留在文件里', function () {
    const review = parsePatchReview(ARGS)
    if (!review) throw new Error('review should exist')
    const written = 'head\nalpha-2\nmid\nbeta-2\ntail'
    const text = rebuildPatchText(written, review, {
      'edit-1': 'discarded'
    })
    expect(text.reverted).toBe(1)
    expect(text.missing).toEqual([])
    expect(text.text).toBe('head\nalpha-2\nmid\nbeta\ntail')
  })

  it('文件之后又被改过：丢弃段找不到 after 就如实回报', function () {
    const review = parsePatchReview(ARGS)
    if (!review) throw new Error('review should exist')
    const text = rebuildPatchText('nothing here', review, { 'edit-0': 'discarded' })
    expect(text.reverted).toBe(0)
    expect(text.missing).toEqual(['edit-0'])
  })

  it('同一段文字在文件里出现多次：拒绝而不是改第一处', function () {
    const review = parsePatchReview({
      path: 'a.ts',
      edits: [{ oldText: 'x', newText: 'y' }]
    })
    if (!review) throw new Error('review should exist')
    // 文件里有两处 `y`：分不清用户想撤哪一处
    const text = rebuildPatchText('y\nmid\ny', review, { 'edit-0': 'discarded' })
    expect(text.ambiguous).toEqual(['edit-0'])
    expect(text.reverted).toBe(0)
    expect(text.text).toBe('y\nmid\ny')
  })

  it('before 里的 `$&` / `$1` 原样写回，不被当成替换模式', function () {
    const review = parsePatchReview({
      path: 'a.ts',
      edits: [{ oldText: 'price $& $1 元', newText: 'cost' }]
    })
    if (!review) throw new Error('review should exist')
    // 旧写法 `text.replace(after, before)` 会把 `$&` 展开成被替换的文字
    const text = rebuildPatchText('cost', review, { 'edit-0': 'discarded' })
    expect(text.text).toBe('price $& $1 元')
    expect(text.reverted).toBe(1)
  })

  it('多段丢弃按原顺序定位：后一块不会被还原到前一块的位置', function () {
    const review = parsePatchReview({
      path: 'a.ts',
      edits: [
        { oldText: 'A', newText: 'A1' },
        { oldText: 'A1', newText: 'A2' }
      ]
    })
    if (!review) throw new Error('review should exist')
    // 写成 A2 之后，「A1」已经不存在：第一块报 missing，第二块照常还原成 A1
    const text = rebuildPatchText('A2', review, { 'edit-0': 'discarded', 'edit-1': 'discarded' })
    expect(text.missing).toEqual(['edit-0'])
    expect(text.reverted).toBe(1)
    expect(text.text).toBe('A1')
  })
})

describe('isSameText', function () {
  it('ignores the line-ending style', function () {
    expect(isSameText('a\r\nb\r\n', 'a\nb\n')).toBe(true)
    expect(isSameText('a\nb\n', 'a\nc\n')).toBe(false)
  })
})
