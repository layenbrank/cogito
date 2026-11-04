import { describe, expect, it } from 'vitest'

import {
  OPTIONAL_TOOL_FILES,
  REQUIRED_BUNDLE_FILES,
  checkVariantGuard,
  parseVariant
} from './variant-guard.ts'

const CORE_FILES = ['Cogito.exe', ...REQUIRED_BUNDLE_FILES]

describe('parseVariant', function () {
  it('默认精简版', function () {
    expect(parseVariant(undefined)).toBe('slim')
    expect(parseVariant('')).toBe('slim')
    expect(parseVariant('SLIM')).toBe('slim')
    expect(parseVariant('lite')).toBe('slim')
  })

  it('识别完整版', function () {
    expect(parseVariant('full')).toBe('full')
    expect(parseVariant(' Full ')).toBe('full')
  })
})

describe('checkVariantGuard', function () {
  it('精简版 + 无可选件 → 放行', function () {
    expect(checkVariantGuard({ variant: 'slim', files: CORE_FILES, allowFull: false }).ok).toBe(true)
  })

  it('精简版混进 ffmpeg → 拦下并提示 --allow-full', function () {
    const result = checkVariantGuard({
      variant: 'slim',
      files: [...CORE_FILES, 'ffmpeg.exe'],
      allowFull: false
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('ffmpeg.exe')
      expect(result.reason).toContain('--allow-full')
    }
  })

  it('--allow-full 显式覆盖', function () {
    const result = checkVariantGuard({
      variant: 'slim',
      files: [...CORE_FILES, 'ffmpeg.exe'],
      allowFull: true
    })
    expect(result.ok).toBe(true)
  })

  it('声明完整版但缺件 → 拦下', function () {
    const result = checkVariantGuard({
      variant: 'full',
      files: [...CORE_FILES, 'pandoc.exe'],
      allowFull: true
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('ffmpeg.exe')
    }
  })

  it('完整版齐全 → 放行', function () {
    const result = checkVariantGuard({
      variant: 'full',
      files: [...CORE_FILES, ...OPTIONAL_TOOL_FILES],
      allowFull: false
    })
    expect(result.ok).toBe(true)
  })

  it('要求校验必需件时，缺 goose → 拦下', function () {
    const result = checkVariantGuard({
      variant: 'slim',
      files: CORE_FILES.filter(function (name) {
        return name !== 'goose.exe'
      }),
      allowFull: false,
      expectCoreFiles: true
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('goose.exe')
    }
  })

  it('--dir 搬来的产物（不校验必需件）→ 放行', function () {
    expect(
      checkVariantGuard({ variant: 'slim', files: ['cogito_1.5.0_x64-setup.exe'], allowFull: false })
        .ok
    ).toBe(true)
  })
})
