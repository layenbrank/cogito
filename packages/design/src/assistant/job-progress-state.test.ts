import { describe, expect, it } from 'vitest'

import {
  clampStageProgress,
  findJobProgress,
  findJobTone,
  formatElapsed,
  resolveStageIndex,
  resolveWeights,
  type JobStage
} from './job-progress-state'

const STAGES: readonly JobStage[] = [
  { name: 'clone', weight: 1 },
  { name: 'install', weight: 4, description: 'Restoring dependencies' },
  { name: 'build', weight: 3 },
  { name: 'test', weight: 2 }
]

const LABELS = {
  jobRunning: 'running',
  jobDone: 'done',
  jobPartial: 'partly done',
  jobFailed: 'failed',
  jobCancelled: 'cancelled'
}

describe('resolveWeights', function () {
  it('合法权重原样保留', function () {
    expect(resolveWeights(STAGES)).toEqual([1, 4, 3, 2])
  })

  it('负数 / 0 / NaN 当 0，其它照旧', function () {
    expect(
      resolveWeights([
        { name: 'a', weight: -2 },
        { name: 'b', weight: Number.NaN },
        { name: 'c', weight: 5 }
      ])
    ).toEqual([0, 0, 5])
  })

  it('全零 / 空列表退回等权（否则除零出 NaN）', function () {
    expect(
      resolveWeights([
        { name: 'a', weight: 0 },
        { name: 'b', weight: 0 }
      ])
    ).toEqual([1, 1])
    expect(resolveWeights([])).toEqual([])
  })
})

describe('resolveStageIndex', function () {
  it('向下取整，负数钳到 0', function () {
    expect(resolveStageIndex(2.9, 4)).toBe(2)
    expect(resolveStageIndex(-3, 4)).toBe(0)
  })

  it('越界钳到 stages.length（等于长度 = 走完了）', function () {
    expect(resolveStageIndex(99, 4)).toBe(4)
    expect(resolveStageIndex(4, 4)).toBe(4)
  })

  it('NaN 当 0', function () {
    expect(resolveStageIndex(Number.NaN, 4)).toBe(0)
  })
})

describe('clampStageProgress', function () {
  it('钳进 0…1，NaN 当 0', function () {
    expect(clampStageProgress(0.6)).toBe(0.6)
    expect(clampStageProgress(2)).toBe(1)
    expect(clampStageProgress(-1)).toBe(0)
    expect(clampStageProgress(Number.NaN)).toBe(0)
  })
})

describe('findJobProgress', function () {
  it('运行中：按权重加权，当前阶段只贡献它那一段的份额', function () {
    // 权重 1+4+3+2=10；走到 install（权重 4）的 0.6 → (1 + 2.4) / 10 = 34%
    const progress = findJobProgress(STAGES, 1, 0.6)
    expect(progress).toMatchObject({
      state: 'running',
      settled: false,
      percent: 34,
      stageIndex: 1
    })
    expect(progress.current?.name).toBe('install')
    expect(progress.stages.map((stage) => stage.status)).toEqual([
      'done',
      'active',
      'ahead',
      'ahead'
    ])
  })

  it('阶段内份额推满时条不会超过这一段的上界', function () {
    // install 走完 = (1 + 4) / 10 = 50%，此时还没进入 build
    expect(findJobProgress(STAGES, 1, 1).percent).toBe(50)
    expect(findJobProgress(STAGES, 1, 5).percent).toBe(50)
    expect(findJobProgress(STAGES, 1, -1).percent).toBe(10)
  })

  it('没有 outcome 但索引走到长度：算成功跑完，条拉满', function () {
    const progress = findJobProgress(STAGES, 4, 0)
    expect(progress).toMatchObject({ state: 'success', settled: true, percent: 100 })
    expect(progress.current).toBeNull()
    expect(progress.stages.every((stage) => stage.status === 'done')).toBe(true)
  })

  it('空阶段表不算「走完」：保持运行态、0%', function () {
    const progress = findJobProgress([], 0, 0)
    expect(progress).toMatchObject({ state: 'running', settled: false, percent: 0 })
    expect(progress.current).toBeNull()
  })

  it('partial 收据：条停在真正到达的位置', function () {
    // (1+4+3+2*0.4) / 10 = 88%
    const progress = findJobProgress(STAGES, 3, 0.4, {
      status: 'partial',
      summary: 'Tests stopped after the preview timed out.'
    })
    expect(progress).toMatchObject({ state: 'partial', settled: true, percent: 88 })
    expect(progress.current?.name).toBe('test')
    expect(progress.stages.map((stage) => stage.status)).toEqual([
      'done',
      'done',
      'done',
      'active'
    ])
  })

  it('success 收据：无视数字进度，条直接拉满', function () {
    const progress = findJobProgress(STAGES, 1, 0.2, { status: 'success' })
    expect(progress).toMatchObject({ state: 'success', settled: true, percent: 100 })
  })

  it('failed / cancelled 同样保持实际进度', function () {
    expect(findJobProgress(STAGES, 2, 0, { status: 'failed' }).percent).toBe(50)
    expect(findJobProgress(STAGES, 2, 0, { status: 'cancelled' }).percent).toBe(50)
  })

  it('权重全零也不炸：退回等权算进度', function () {
    const progress = findJobProgress(
      [
        { name: 'a', weight: 0 },
        { name: 'b', weight: 0 }
      ],
      1,
      0.5
    )
    expect(progress.percent).toBe(75)
  })
})

describe('formatElapsed', function () {
  it('72 秒 → 1m 12s，ISO 时长 PT72S', function () {
    expect(formatElapsed(72_000)).toEqual({ text: '1m 12s', iso: 'PT72S' })
  })

  it('不到 10 秒留一位小数（与回合尾注同一口径）', function () {
    expect(formatElapsed(4800)).toEqual({ text: '4.8s', iso: 'PT5S' })
  })

  it('0 也要有个词，不能空着', function () {
    expect(formatElapsed(0)).toEqual({ text: '0s', iso: 'PT0S' })
  })

  it('没有 / 负数 / NaN 返回 null（槽里退回状态词）', function () {
    expect(formatElapsed(undefined)).toBeNull()
    expect(formatElapsed(-1)).toBeNull()
    expect(formatElapsed(Number.NaN)).toBeNull()
  })
})

describe('findJobTone', function () {
  it('运行中：转圈 + 中性条 + 「运行中」兜底词', function () {
    expect(findJobTone('running', LABELS)).toMatchObject({
      icon: 'lucide:loader-circle',
      barClassName: 'bg-foreground/80',
      word: 'running'
    })
  })

  it('成功：绿勾 + 绿色条 + done', function () {
    expect(findJobTone('success', LABELS)).toMatchObject({
      icon: 'lucide:check',
      iconClassName: 'text-success',
      barClassName: 'bg-success',
      word: 'done'
    })
  })

  it('partial / failed / cancelled 各自的色与词', function () {
    expect(findJobTone('partial', LABELS)).toMatchObject({
      icon: 'lucide:circle-alert',
      barClassName: 'bg-warning',
      word: 'partly done'
    })
    expect(findJobTone('failed', LABELS)).toMatchObject({
      barClassName: 'bg-destructive',
      word: 'failed'
    })
    expect(findJobTone('cancelled', LABELS)).toMatchObject({
      icon: 'lucide:circle-slash',
      barClassName: 'bg-muted-foreground',
      word: 'cancelled'
    })
  })
})
