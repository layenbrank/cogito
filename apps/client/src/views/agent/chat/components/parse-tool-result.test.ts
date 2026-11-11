import { describe, expect, it } from 'vitest'

import {
  extractQuery,
  extractWebQuery,
  parseRetrievalHits,
  parseToolCard,
  parseToolOutputText,
  parseWebSources,
  parseWriteCodeDiff,
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

describe('parseWebSources', function () {
  it('结构化结果优先：带出标题与域名', function () {
    const sources = parseWebSources(
      'web_search',
      { query: 'draft' },
      {
        results: [{ title: 'Persisting composer state', url: 'https://www.assistant-ui.com/docs' }]
      }
    )
    expect(sources).toEqual([
      {
        title: 'Persisting composer state',
        href: 'https://www.assistant-ui.com/docs',
        domain: 'assistant-ui.com'
      }
    ])
  })

  it('往下钻一层：{data: {sources: [...]}}', function () {
    const sources = parseWebSources(
      'web_search',
      {},
      {
        data: { sources: [{ name: 'Nested', link: 'https://react.dev/a' }] }
      }
    )
    expect(
      sources.map(function (item) {
        return item.title
      })
    ).toEqual(['Nested'])
  })

  it('同一条链接只留一行', function () {
    const sources = parseWebSources(
      'web_search',
      {},
      {
        results: [
          { title: 'A', url: 'https://react.dev/a' },
          { title: 'A again', url: 'https://react.dev/a' }
        ]
      }
    )
    expect(sources).toHaveLength(1)
  })

  it('web_fetch 的 url 参数排最前，标题取查询词', function () {
    const sources = parseWebSources(
      'web_fetch',
      {
        url: 'https://react.dev/reference',
        query: 'useSyncExternalStore'
      },
      { content: 'no links here' }
    )
    expect(sources[0]).toEqual({
      title: 'useSyncExternalStore',
      href: 'https://react.dev/reference',
      domain: 'react.dev'
    })
  })

  it('文本兜底：markdown 链接拆出标题，裸 URL 用链接当标题', function () {
    const sources = parseWebSources(
      'web_search',
      {},
      undefined,
      '[Draft autosave](https://patterns.dev/draft) and https://react.dev/b'
    )
    expect(
      sources.map(function (item) {
        return item.title
      })
    ).toEqual(['Draft autosave', 'https://react.dev/b'])
  })

  it('非联网工具不产出来源', function () {
    expect(parseWebSources('shell', {}, 'https://react.dev/a')).toEqual([])
  })
})

describe('extractWebQuery', function () {
  it('认 query / q / keyword 一类的字段', function () {
    expect(extractWebQuery({ query: 'draft' })).toBe('draft')
    expect(extractWebQuery({ q: 'draft' })).toBe('draft')
    expect(extractWebQuery({ keywords: 'draft' })).toBe('draft')
  })

  it('取不到给 null，卡片退回工具名', function () {
    expect(extractWebQuery(null)).toBeNull()
    expect(extractWebQuery({ url: 'https://react.dev' })).toBeNull()
  })
})

describe('parseRetrievalHits', function () {
  const RESULT = {
    mode: 'fts',
    channels: ['fts'],
    hits: [
      {
        docId: 'd1',
        title: '发布契约',
        relPath: 'wiki/publish.md',
        snippet: '发布前先跑 pnpm check',
        score: -3.2,
        mode: 'fts'
      },
      {
        docId: 'd2',
        title: '会议纪要',
        relPath: 'wiki/meeting.md',
        snippet: '讨论了发布流程',
        score: -1.4,
        mode: 'fts'
      }
    ]
  }

  it('命中行带标题 / 路径 / 片段，并换算成相对分数', function () {
    const hits = parseRetrievalHits(RESULT)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({
      id: 'd1',
      source: '发布契约',
      locator: 'wiki/publish.md',
      text: '发布前先跑 pnpm check',
      fuzzy: false
    })
    // bm25 越小越相关：最相关的记 1.00，末位压到 0.50
    expect(hits[0].score).toBeCloseTo(1)
    expect(hits[1].score).toBeCloseTo(0.5)
  })

  it('短词回退（like）没有可信分数 → fuzzy，且分数归零', function () {
    const hits = parseRetrievalHits({
      mode: 'like',
      hits: [{ docId: 'd3', title: '会议纪要', relPath: 'wiki/m.md', snippet: 's', score: 0, mode: 'like' }]
    })
    expect(hits[0].fuzzy).toBe(true)
    expect(hits[0].score).toBe(0)
  })

  it('缺标题时用文件名，缺 id 时用路径 + 下标', function () {
    const hits = parseRetrievalHits({ hits: [{ relPath: 'wiki/deep/notes.md', snippet: 's', score: -1 }] })
    expect(hits[0].source).toBe('notes.md')
    expect(hits[0].id).toBe('wiki/deep/notes.md#0')
  })

  it('结果是编码过的 JSON 字符串也能解', function () {
    expect(parseRetrievalHits(JSON.stringify(RESULT))).toHaveLength(2)
  })

  it('没有 hits 时给空数组（卡片走空态）', function () {
    expect(parseRetrievalHits({ mode: 'fts' })).toEqual([])
    expect(parseRetrievalHits(undefined)).toEqual([])
  })
})

describe('extractQuery', function () {
  it('库内检索与联网检索共用字段名', function () {
    expect(extractQuery({ query: '发布契约' })).toBe('发布契约')
    expect(extractQuery({ q: 'draft' })).toBe('draft')
    expect(extractQuery(null)).toBeNull()
  })
})
