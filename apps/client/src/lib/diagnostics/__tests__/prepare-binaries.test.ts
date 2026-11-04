/**
 * 打包档位的纯逻辑用例（不触碰磁盘上的 binaries 目录，只测纯函数）。
 *
 * 为什么放在 `src/` 下：client 的 vitest 只扫 `src/**`，脚本目录不在 include 里。
 */
import { describe, expect, it } from 'vitest'

import {
  ALWAYS_BINARIES,
  FULL_ONLY_RESOURCES,
  buildGeneratedConf,
  parseVariant,
  stagedFileName
} from '../../../../scripts/prepare-binaries.ts'

describe('parseVariant', () => {
  it('默认 slim', () => {
    expect(parseVariant(undefined)).toBe('slim')
    expect(parseVariant('')).toBe('slim')
    expect(parseVariant('  ')).toBe('slim')
    expect(parseVariant('SLIM')).toBe('slim')
  })

  it('只有明确的 full 才切档', () => {
    expect(parseVariant('full')).toBe('full')
    expect(parseVariant(' FULL ')).toBe('full')
    expect(parseVariant('lite')).toBe('slim')
  })
})

describe('stagedFileName', () => {
  it('带上目标 triple 与平台后缀', () => {
    const name = stagedFileName('corex-daemon', 'x86_64-pc-windows-msvc')
    expect(name.startsWith('corex-daemon-x86_64-pc-windows-msvc')).toBe(true)
    expect(name.endsWith(process.platform === 'win32' ? '.exe' : '')).toBe(true)
  })
})

describe('buildGeneratedConf', () => {
  it('slim 绝不包含 ffmpeg / ffprobe / pandoc', () => {
    const conf = buildGeneratedConf('slim')
    const resources = (conf.bundle as { resources: Record<string, string> }).resources
    for (const key of Object.keys(FULL_ONLY_RESOURCES)) {
      expect(resources).not.toHaveProperty(key)
    }
    expect(resources).toHaveProperty('binaries/pdfium.dll')
    expect(resources).toHaveProperty('icons/')
  })

  it('full 追加三个可选件', () => {
    const conf = buildGeneratedConf('full')
    const resources = (conf.bundle as { resources: Record<string, string> }).resources
    expect(Object.keys(resources).sort()).toEqual(
      ['binaries/ffmpeg.exe', 'binaries/ffprobe.exe', 'binaries/pandoc.exe', 'binaries/pdfium.dll', 'icons/'].sort()
    )
  })

  it('externalBin 两个档位一致且不含 triple 后缀', () => {
    const slim = buildGeneratedConf('slim').bundle as { externalBin: string[] }
    const full = buildGeneratedConf('full').bundle as { externalBin: string[] }
    expect(slim.externalBin).toEqual(full.externalBin)
    expect(slim.externalBin).toEqual(ALWAYS_BINARIES.map((name) => `binaries/${name}`))
  })
})
