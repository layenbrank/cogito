import { describe, expect, it } from 'vitest'

import { autoPtgSizes, fitPtgSizes, limitPtgSizes, ptgToLayoutPct, sizeToPtg } from './size-util'

describe('sizeToPtg', function () {
  it('parses percent strings', function () {
    expect(sizeToPtg('25%', 1000)).toBeCloseTo(0.25)
  })

  it('parses pixel numbers against container', function () {
    expect(sizeToPtg(200, 1000)).toBeCloseTo(0.2)
  })

  it('returns undefined when container is 0', function () {
    expect(sizeToPtg(200, 0)).toBeUndefined()
  })
})

describe('limitPtgSizes', function () {
  it('clamps explicit sizes to min but leaves collapsed alone', function () {
    const next = limitPtgSizes([0.05, 0.5, 0.45], [0.2, 0.1, 0.1], [true, false, false])
    expect(next[0]).toBeCloseTo(0.05)
    expect(next[1]).toBeCloseTo(0.5)
  })

  it('raises sub-min sizes when not collapsed', function () {
    const next = limitPtgSizes([0.05, 0.95], [0.2, 0.1], [false, false])
    expect(next[0]).toBeCloseTo(0.2)
  })
})

describe('autoPtgSizes', function () {
  it('fills undefined panes with remaining space', function () {
    const next = autoPtgSizes([0.2, undefined, undefined], [0, 0, 0], [1, 1, 1])
    expect(next[0]).toBeCloseTo(0.2)
    expect(next[1]! + next[2]!).toBeCloseTo(0.8)
  })

  it('scales all-defined sizes that do not sum to 1', function () {
    const next = autoPtgSizes([0.2, 0.2, 0.2], [0, 0, 0], [1, 1, 1])
    expect(
      next.reduce(function (a, b) {
        return a + b
      }, 0)
    ).toBeCloseTo(1)
  })
})

describe('fitPtgSizes', function () {
  it('keeps collapsed panes at 0 under min pressure', function () {
    const next = fitPtgSizes([0, 0.4, 0.6], [0.2, 0.2, 0.2], [1, 1, 1])
    expect(next[0]).toBeCloseTo(0)
  })
})

describe('ptgToLayoutPct', function () {
  it('emits 0..100 and absorbs float dust into the last pane', function () {
    const pct = ptgToLayoutPct([1 / 3, 1 / 3, 1 / 3])
    expect(
      pct.reduce(function (a, b) {
        return a + b
      }, 0)
    ).toBeCloseTo(100)
  })
})
