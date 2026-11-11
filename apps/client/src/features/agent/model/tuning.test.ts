import { describe, expect, it } from 'vitest'

import { readTuning, toGooseTemperature } from '@/features/agent/model/tuning'

describe('toGooseTemperature', function () {
  it('把元素滑杆的 0–2 钳进 goose 的 0–1', function () {
    expect(toGooseTemperature(0)).toBe(0)
    expect(toGooseTemperature(0.7)).toBe(0.7)
    expect(toGooseTemperature(1)).toBe(1)
    expect(toGooseTemperature(1.6)).toBe(1)
  })

  it('非有限数与负数都归 0', function () {
    expect(toGooseTemperature(Number.NaN)).toBe(0)
    expect(toGooseTemperature(Number.POSITIVE_INFINITY)).toBe(0)
    expect(toGooseTemperature(-1)).toBe(0)
  })
})

describe('readTuning', function () {
  it('读到的就是 agent.json 里的三项，缺省时给默认值', function () {
    const tuning = readTuning()
    expect(Number.isFinite(tuning.temperature)).toBe(true)
    expect(typeof tuning.extraSystemPrompt).toBe('string')
    expect(tuning.corexMcpTools === '0' || tuning.corexMcpTools === '1').toBe(true)
  })
})
