import { describe, expect, it } from 'vitest'

import {
  SOURCE_WATCH_DEFAULTS,
  isPathAllowedBySourceWatch,
  normalizeSourceWatchConfig,
  pathMatchesWatch
} from '@/views/knowledge/lib/source-watch-config.ts'

describe('normalizeSourceWatchConfig', function () {
  it('fills defaults including dual concurrency and parsed flag', function () {
    const config = normalizeSourceWatchConfig({})
    expect(config.persistExtractedMarkdown).toBe(false)
    expect(config.parsingConcurrency).toBe(2)
    expect(config.ingestConcurrency).toBe(1)
    expect(config.maxFileSizeMb).toBe(100)
    expect(config.includeExtensions).toContain('docx')
    expect(config.includeExtensions).toContain('pptx')
    expect(config.includeExtensions).toContain('xlsx')
    expect(config.includeExtensions).toContain('png')
  })

  it('clamps concurrency', function () {
    expect(normalizeSourceWatchConfig({ parsingConcurrency: 100 }).parsingConcurrency).toBe(64)
    expect(normalizeSourceWatchConfig({ ingestConcurrency: 0 }).ingestConcurrency).toBe(1)
    expect(
      normalizeSourceWatchConfig({ parsingConcurrency: Number.NaN }).parsingConcurrency
    ).toBe(2)
  })

  it('normalizes comma-separated lists without dots', function () {
    const config = normalizeSourceWatchConfig({
      includeExtensions: ['md, pdf', '.docx'],
      excludeExtensions: ['json, yaml\nxml，dll'],
      excludeDirs: ['.git, node_modules', 'drafts，wip'],
      excludeGlobs: ['*.private.*, ~$*']
    })
    expect(config.includeExtensions).toEqual(['md', 'pdf', 'docx'])
    expect(config.excludeExtensions).toEqual(['json', 'yaml', 'xml', 'dll'])
    expect(config.excludeDirs).toEqual(['.git', 'node_modules', 'drafts', 'wip'])
    expect(config.excludeGlobs).toEqual(['*.private.*', '~$*'])
  })

  it('upgrades legacy cogito short include list to full defaults', function () {
    const config = normalizeSourceWatchConfig({
      includeExtensions: ['.md', '.markdown', '.pdf', '.txt', '.png', '.jpg', '.jpeg']
    })
    expect(config.includeExtensions).toEqual(SOURCE_WATCH_DEFAULTS.includeExtensions)
  })
})

describe('isPathAllowedBySourceWatch', function () {
  it('accepts included document types by default', function () {
    expect(
      isPathAllowedBySourceWatch('raw/sources/report.pdf', SOURCE_WATCH_DEFAULTS)
    ).toBe(true)
    expect(isPathAllowedBySourceWatch('raw/sources/notes.md', SOURCE_WATCH_DEFAULTS)).toBe(
      true
    )
    expect(isPathAllowedBySourceWatch('raw/sources/deck.pptx', SOURCE_WATCH_DEFAULTS)).toBe(
      true
    )
  })

  it('rejects config/media/binaries not in include list', function () {
    expect(
      isPathAllowedBySourceWatch('raw/sources/secrets.json', SOURCE_WATCH_DEFAULTS)
    ).toBe(false)
    expect(isPathAllowedBySourceWatch('raw/sources/video.mp4', SOURCE_WATCH_DEFAULTS)).toBe(
      false
    )
    expect(isPathAllowedBySourceWatch('raw/sources/tool.exe', SOURCE_WATCH_DEFAULTS)).toBe(
      false
    )
  })

  it('applies directory and glob exclusions', function () {
    const config = normalizeSourceWatchConfig({
      includeExtensions: ['md'],
      excludeDirs: ['.obsidian', 'drafts'],
      excludeGlobs: ['*.private.*', '~$*']
    })
    expect(isPathAllowedBySourceWatch('raw/sources/ready.md', config)).toBe(true)
    expect(isPathAllowedBySourceWatch('raw/sources/drafts/ready.md', config)).toBe(false)
    expect(isPathAllowedBySourceWatch('raw/sources/subdir/drafts/ready.md', config)).toBe(
      false
    )
    expect(isPathAllowedBySourceWatch('raw/sources/.obsidian/index.md', config)).toBe(false)
    expect(isPathAllowedBySourceWatch('raw/sources/plan.private.md', config)).toBe(false)
    expect(isPathAllowedBySourceWatch('raw/sources/~$Document.docx', config)).toBe(false)
  })

  it('pathMatchesWatch stays as alias', function () {
    expect(pathMatchesWatch('C:/kb/raw/sources/note.md', SOURCE_WATCH_DEFAULTS)).toBe(true)
    expect(
      pathMatchesWatch('C:/kb/raw/sources/.git/x.md', {
        ...SOURCE_WATCH_DEFAULTS,
        excludeDirs: ['.git']
      })
    ).toBe(false)
  })
})
