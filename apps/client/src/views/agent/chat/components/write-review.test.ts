/**
 * 写工具卡「按块审阅」的纯逻辑：切块、范围标记、按决定合成正文。
 *
 * 这里不覆盖「能不能落盘」——那一步要和磁盘现状比对，属于组件里的动作
 * （片段级 old_string / new_string 也会切出块，只是落盘前会被拒掉）。
 */
import { describe, expect, it } from 'vitest'

import { isSameText, parseWriteReview, rebuildReviewedText } from './write-review'

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

describe('isSameText', function () {
  it('ignores the line-ending style', function () {
    expect(isSameText('a\r\nb\r\n', 'a\nb\n')).toBe(true)
    expect(isSameText('a\nb\n', 'a\nc\n')).toBe(false)
  })
})
