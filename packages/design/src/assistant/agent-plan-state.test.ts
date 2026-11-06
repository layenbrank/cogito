import { describe, expect, it } from 'vitest'

import {
  findPlanProgress,
  findStepStatus,
  formatPlanCount,
  resolveActiveIndex,
  toPlanSteps
} from './agent-plan-state'

const LABELS = { planCount: (completed: number, total: number) => `${completed} / ${total}` }

describe('resolveActiveIndex', function () {
  it('不传 / NaN 当成 0', function () {
    expect(resolveActiveIndex(undefined, 5)).toBe(0)
    expect(resolveActiveIndex(Number.NaN, 5)).toBe(0)
  })

  it('向下取整，负数钳到 0', function () {
    expect(resolveActiveIndex(2.9, 5)).toBe(2)
    expect(resolveActiveIndex(-3, 5)).toBe(0)
  })

  it('越界钳到 total（等于 total 表示全部完成）', function () {
    expect(resolveActiveIndex(99, 5)).toBe(5)
    expect(resolveActiveIndex(5, 5)).toBe(5)
  })

  it('空列表怎么传都是 0', function () {
    expect(resolveActiveIndex(3, 0)).toBe(0)
  })
})

describe('toPlanSteps', function () {
  it('字符串补出对象与下标 id', function () {
    expect(toPlanSteps(['a', 'b'])).toEqual([
      { id: 'plan-step-0', label: 'a', description: undefined },
      { id: 'plan-step-1', label: 'b', description: undefined }
    ])
  })

  it('对象保留自己的 id 与 description', function () {
    expect(toPlanSteps([{ id: 'x', label: 'a', description: 'more' }])).toEqual([
      { id: 'x', label: 'a', description: 'more' }
    ])
  })
})

describe('findPlanProgress', function () {
  it('进行中第一步：0 完成，0%', function () {
    expect(findPlanProgress(5, 0)).toEqual({
      total: 5,
      completed: 0,
      activeIndex: 0,
      percent: 0,
      allDone: false
    })
  })

  it('中间那一步：2 完成，40%（四舍五入）', function () {
    expect(findPlanProgress(5, 2)).toMatchObject({ completed: 2, percent: 40, allDone: false })
    expect(findPlanProgress(3, 1).percent).toBe(33)
  })

  it('传满或越界 = 全部完成，没有「进行中」', function () {
    expect(findPlanProgress(5, 5)).toMatchObject({ completed: 5, percent: 100, allDone: true })
    expect(findPlanProgress(5, 99)).toMatchObject({ completed: 5, percent: 100, allDone: true })
  })

  it('空列表：0 完成、0%、不算「全部完成」', function () {
    expect(findPlanProgress(0, 0)).toMatchObject({ completed: 0, percent: 0, allDone: false })
  })

  it('idle（还没开始）：0 完成、没有 active 那一步（-1）', function () {
    expect(findPlanProgress(3, 0, true)).toEqual({
      total: 3,
      completed: 0,
      activeIndex: -1,
      percent: 0,
      allDone: false
    })
    // 传什么 activeIndex 都不算数：idle 就是一步都没开始
    expect(findPlanProgress(3, 2, true).activeIndex).toBe(-1)
  })
})

describe('findStepStatus', function () {
  it('下标之前 done、等于是 active、之后是 ahead', function () {
    const progress = findPlanProgress(5, 2)
    expect([0, 1, 2, 3, 4].map((index) => findStepStatus(index, progress))).toEqual([
      'done',
      'done',
      'active',
      'ahead',
      'ahead'
    ])
  })

  it('全部完成时没有任何一步是 active', function () {
    const progress = findPlanProgress(2, 2)
    expect([0, 1].map((index) => findStepStatus(index, progress))).toEqual(['done', 'done'])
  })

  it('idle 时每一步都是 ahead（圆点，没有转圈）', function () {
    const progress = findPlanProgress(2, 0, true)
    expect([0, 1].map((index) => findStepStatus(index, progress))).toEqual(['ahead', 'ahead'])
  })
})

describe('formatPlanCount', function () {
  it('走 labels，组件里不写死语言', function () {
    expect(formatPlanCount(findPlanProgress(5, 5), LABELS)).toBe('5 / 5')
  })
})
