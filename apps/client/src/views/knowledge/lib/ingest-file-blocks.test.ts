import { describe, expect, it } from 'vitest'

import {
  isSafeIngestPath,
  parseFileBlocks
} from '@/views/knowledge/lib/ingest-file-blocks.ts'

describe('isSafeIngestPath', function () {
  it('允许 wiki/ 下相对路径', function () {
    expect(isSafeIngestPath('wiki/concepts/foo.md')).toBe(true)
  })

  it('拒绝逃逸与绝对路径', function () {
    expect(isSafeIngestPath('../etc/passwd')).toBe(false)
    expect(isSafeIngestPath('/etc/passwd')).toBe(false)
    expect(isSafeIngestPath('C:/Windows/x.md')).toBe(false)
    expect(isSafeIngestPath('wiki/../secret.md')).toBe(false)
    expect(isSafeIngestPath('raw/sources/a.md')).toBe(false)
  })
})

describe('parseFileBlocks', function () {
  it('解析标准 FILE 块', function () {
    const text = [
      '---FILE: wiki/alpha.md---',
      '---',
      'title: Alpha',
      '---',
      '',
      '# Alpha',
      '---END FILE---'
    ].join('\n')
    const parsed = parseFileBlocks(text)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]?.path).toBe('wiki/alpha.md')
    expect(parsed.blocks[0]?.content).toContain('# Alpha')
    expect(parsed.warnings).toHaveLength(0)
  })

  it('容忍 CRLF 与 END FILE 空白变体', function () {
    const text = '---FILE: wiki/b.md---\r\nbody\r\n--- END FILE ---\r\n'
    const parsed = parseFileBlocks(text)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]?.content.trim()).toBe('body')
  })

  it('截断未闭合块给出 warning', function () {
    const text = '---FILE: wiki/cut.md---\npartial'
    const parsed = parseFileBlocks(text)
    expect(parsed.blocks).toHaveLength(0)
    expect(parsed.warnings.length).toBeGreaterThan(0)
    expect(parsed.truncatedPaths).toContain('wiki/cut.md')
  })

  it('fence 内的 END FILE 不当闭合', function () {
    const text = [
      '---FILE: wiki/doc.md---',
      '```',
      '---END FILE---',
      '```',
      'ok',
      '---END FILE---'
    ].join('\n')
    const parsed = parseFileBlocks(text)
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0]?.content).toContain('---END FILE---')
    expect(parsed.blocks[0]?.content).toContain('ok')
  })

  it('拒绝聚合页与不安全路径', function () {
    const text = [
      '---FILE: wiki/index.md---',
      'x',
      '---END FILE---',
      '---FILE: wiki/../escape.md---',
      'y',
      '---END FILE---'
    ].join('\n')
    const parsed = parseFileBlocks(text)
    expect(parsed.blocks).toHaveLength(0)
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(2)
  })
})
