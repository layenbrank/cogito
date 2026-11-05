import { describe, expect, it } from 'vitest'

import { parseToolCard, parseToolOutputText, parseWriteCodeDiff, parseWriteDiffStat } from './parse-tool-result'

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

  // 以下四种文本以前会被「猜」成 test / stack / env / commit 专项卡，本轮已下线
  // （见 parse-tool-result.ts 头注）。这些用例现在锁住「不再产生专项」。
  it('does not promote vitest summary to a test card', function () {
    const parsed = parseToolCard('shell', { command: 'pnpm test' }, 'Tests 2 passed | 0 failed')
    expect(parsed.variant).toBe('command')
    expect(parsed.special).toBeNull()
  })

  it('does not promote stack traces to a stack card', function () {
    const text = [
      'TypeError: boom',
      '    at handler (src/app.ts:10:5)',
      '    at run (src/main.ts:2:1)'
    ].join('\n')
    const parsed = parseToolCard('generic', {}, text)
    expect(parsed.variant).toBe('generic')
    expect(parsed.special).toBeNull()
  })

  it('does not promote KEY=VALUE lists to an env card', function () {
    const parsed = parseToolCard('env', {}, 'API_URL=https://example.com\nTOKEN=secret')
    expect(parsed.variant).toBe('generic')
    expect(parsed.special).toBeNull()
  })

  it('does not promote pseudo commit output to a commit card', function () {
    const text = ['abc1234 feat: init', 'M apps/client/src/main.ts', 'A README.md'].join('\n')
    const parsed = parseToolCard('git_commit', {}, text)
    expect(parsed.variant).toBe('generic')
    expect(parsed.special).toBeNull()
  })

  it('does not promote short shell output to snippet', function () {
    const parsed = parseToolCard('shell', { command: 'rg foo src' }, 'src/a.ts:1:match')
    expect(parsed.variant).toBe('command')
  })
})

describe('parseToolCard / 文件树', function () {
  it('renders directory listings from structured paths', function () {
    const parsed = parseToolCard('list_dir', {}, { paths: ['src/a.ts', 'src/nested/', 'README.md'] })
    expect(parsed.variant).toBe('tree')
    expect(parsed.special?.kind).toBe('tree')
    if (parsed.special?.kind === 'tree') {
      expect(parsed.special.data).toHaveLength(3)
      expect(parsed.special.data[1]).toEqual({ path: 'src/nested/', isDirectory: true })
    }
  })

  it('does not turn ordinary read output into a tree', function () {
    const parsed = parseToolCard('read_file', { path: 'a.ts' }, 'src/a.ts\nsrc/b.ts')
    expect(parsed.special).toBeNull()
    expect(parsed.variant).toBe('read')
  })
})

describe('parseWriteDiffStat', function () {
  it('counts LCS additions for str_replace', function () {
    const stat = parseWriteDiffStat({
      path: 'a.ts',
      old_string: 'a\nb',
      new_string: 'a\nb\nc\nd'
    })
    expect(stat).toEqual({ added: 2, removed: 0 })
  })

  it('treats write contents as pure additions', function () {
    const stat = parseWriteDiffStat({ path: 'a.ts', contents: 'one\ntwo\nthree' })
    expect(stat).toEqual({ added: 3, removed: 0 })
  })
})

describe('parseWriteCodeDiff', function () {
  it('builds unified lines for before/after', function () {
    const diff = parseWriteCodeDiff({
      path: 'doctor.config.ts',
      before: "ignore: ['src/a.ts']",
      after: "ignore: ['src/a.ts', 'src/b.ts']"
    })
    expect(diff).toEqual({
      filename: 'doctor.config.ts',
      additions: 1,
      deletions: 1,
      lines: [
        { kind: 'removed', text: "ignore: ['src/a.ts']" },
        { kind: 'added', text: "ignore: ['src/a.ts', 'src/b.ts']" }
      ]
    })
  })

  it('keeps shared lines as context', function () {
    const diff = parseWriteCodeDiff({
      path: 'a.ts',
      old_string: 'keep\nold\nkeep',
      new_string: 'keep\nnew\nkeep'
    })
    expect(diff?.lines).toEqual([
      { kind: 'context', text: 'keep' },
      { kind: 'removed', text: 'old' },
      { kind: 'added', text: 'new' },
      { kind: 'context', text: 'keep' }
    ])
    expect(diff?.additions).toBe(1)
    expect(diff?.deletions).toBe(1)
  })
})
