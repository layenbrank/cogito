import { describe, expect, it } from 'vitest'

import {
  findToolCardVariant,
  parseToolCard,
  parseToolOutputText,
  parseToolSpecial,
  parseWriteDiffStat
} from './parse-tool-result'

describe('parseToolOutputText', function () {
  it('keeps multiline shell output', function () {
    expect(parseToolOutputText('line1\nline2')).toBe('line1\nline2')
  })
})

describe('parseToolCard', function () {
  it('keeps shell as command for stdout/stderr objects', function () {
    const parsed = parseToolCard(
      'shell',
      { command: 'type package.json' },
      { stdout: '{"name":"cogito"}', stderr: '', exit_code: 0 }
    )
    expect(parsed.variant).toBe('command')
    expect(parsed.special).toBeNull()
    expect(parsed.text).toContain('cogito')
  })

  it('allows vitest summary to override shell', function () {
    const parsed = parseToolCard(
      'shell',
      { command: 'pnpm test' },
      'Tests 2 passed | 0 failed'
    )
    expect(parsed.variant).toBe('test')
    expect(parsed.special?.kind).toBe('test')
  })

  it('does not promote short shell output to snippet', function () {
    const parsed = parseToolCard('shell', { command: 'rg foo src' }, 'src/a.ts:1:match')
    expect(parsed.variant).toBe('command')
  })

  it('detects stack traces on generic tools', function () {
    const text = [
      'TypeError: boom',
      '    at handler (src/app.ts:10:5)',
      '    at run (src/main.ts:2:1)'
    ].join('\n')
    const parsed = parseToolCard('generic', {}, text)
    expect(parsed.variant).toBe('stack')
  })

  it('detects env KEY=VALUE lists on generic tools', function () {
    const parsed = parseToolCard('env', {}, 'API_URL=https://example.com\nTOKEN=secret')
    expect(parsed.variant).toBe('env')
  })

  it('detects pseudo commit output', function () {
    const text = ['abc1234 feat: init', 'M apps/client/src/main.ts', 'A README.md'].join('\n')
    const parsed = parseToolCard('git_commit', {}, text)
    expect(parsed.variant).toBe('commit')
    if (parsed.special?.kind === 'commit') {
      expect(parsed.special.data.hash).toBe('abc1234')
      expect(parsed.special.data.files).toHaveLength(2)
    }
  })
})

describe('parseWriteDiffStat', function () {
  it('counts old/new string lines for str_replace', function () {
    const stat = parseWriteDiffStat({
      path: 'a.ts',
      old_string: 'a\nb',
      new_string: 'a\nb\nc\nd'
    })
    expect(stat).toEqual({ added: 4, removed: 2 })
  })

  it('treats write contents as pure additions', function () {
    const stat = parseWriteDiffStat({ path: 'a.ts', contents: 'one\ntwo\nthree' })
    expect(stat).toEqual({ added: 3, removed: 0 })
  })
})

describe('legacy wrappers', function () {
  it('parseToolSpecial still returns stack', function () {
    const text = [
      'TypeError: boom',
      '    at handler (src/app.ts:10:5)',
      '    at run (src/main.ts:2:1)'
    ].join('\n')
    expect(parseToolSpecial('generic', {}, text)?.kind).toBe('stack')
  })

  it('findToolCardVariant respects family allow-list', function () {
    const snippet = parseToolSpecial('shell', { command: 'rg foo' }, 'hit')
    expect(findToolCardVariant('shell', snippet)).toBe('command')
    expect(findToolCardVariant('read_file', null)).toBe('read')
  })
})
