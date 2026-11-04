import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', function () {
  return {
    invoke: vi.fn(function () {
      return Promise.resolve(null)
    })
  }
})

import {
  CAPTURE_STYLE,
  mergeCapture,
  mergeCaptureStyle,
  mergeCaptureUpdate
} from '@/stores/setting'

describe('mergeCaptureStyle', function () {
  it('没有存盘时回默认样式', function () {
    expect(mergeCaptureStyle()).toEqual(CAPTURE_STYLE)
  })

  it('逐字段兜底：坏字段不牵连其它字段', function () {
    const merged = mergeCaptureStyle({ color: 'not-a-color', thickness: 4 })
    expect(merged.color).toBe(CAPTURE_STYLE.color)
    expect(merged.thickness).toBe(4)
    expect(merged.opacity).toBe(CAPTURE_STYLE.opacity)
    expect(merged.fontSize).toBe(CAPTURE_STYLE.fontSize)
  })

  it('越界值按 clamp 收口', function () {
    const merged = mergeCaptureStyle({ thickness: 9999, opacity: -3, fontSize: 2 })
    expect(merged.thickness).toBe(32)
    expect(merged.opacity).toBe(0)
    expect(merged.fontSize).toBe(8)
  })

  it('保留合法颜色（含大小写）', function () {
    expect(mergeCaptureStyle({ color: '#AbCdEf' }).color).toBe('#AbCdEf')
  })
})

describe('mergeCapture', function () {
  it('旧存盘没有 style 时补默认值', function () {
    const merged = mergeCapture({ detect: 'window' })
    expect(merged.detect).toBe('window')
    expect(merged.style).toEqual(CAPTURE_STYLE)
  })

  it('存盘里的 style 被原样保留', function () {
    const merged = mergeCapture({
      style: { color: '#112233', thickness: 6, filled: true, opacity: 0.5, fontSize: 24 }
    })
    expect(merged.style).toEqual({
      color: '#112233',
      thickness: 6,
      filled: true,
      opacity: 0.5,
      fontSize: 24
    })
  })
})

describe('mergeCaptureUpdate', function () {
  it('只改 style 时不动 detect / retention', function () {
    const current = mergeCapture()
    const next = mergeCaptureUpdate(current, { style: { ...current.style, thickness: 8 } })
    expect(next.detect).toBe(current.detect)
    expect(next.retention).toBe(current.retention)
    expect(next.style.thickness).toBe(8)
    expect(next.style.color).toBe(current.style.color)
  })
})
