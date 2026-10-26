import { describe, expect, it } from 'vitest'

import { sortHits, uniqueHits } from '@/features/command-bar/rank'
import type { Hit } from '@/features/command-bar/types'

function stub(partial: Pick<Hit, 'domain' | 'id' | 'title'> & Partial<Hit>): Hit {
  return {
    score: 0.5,
    run() {},
    ...partial
  }
}

describe('command-bar rank', function () {
  it('dedupes by domain:id keeping first', function () {
    const hits = uniqueHits([
      stub({ domain: 'tile', id: 'a', title: '代码', score: 0.9 }),
      stub({ domain: 'tile', id: 'a', title: '代码', score: 0.1 }),
      stub({ domain: 'knowledge', id: 'a', title: '其它' })
    ])
    expect(hits).toHaveLength(2)
    expect(hits[0].score).toBe(0.9)
    expect(hits[1].domain).toBe('knowledge')
  })

  it('sortHits also dedupes', function () {
    const hits = sortHits([
      stub({ domain: 'knowledge', id: 'p', title: 'prompt.md' }),
      stub({ domain: 'knowledge', id: 'p', title: 'prompt.md' }),
      stub({ domain: 'knowledge', id: 'p', title: 'prompt.md' })
    ])
    expect(hits).toHaveLength(1)
  })

  it('collapses same title+subtitle across different ids', function () {
    const hits = sortHits([
      stub({
        domain: 'tile',
        id: 'uuid-1',
        title: '书签',
        subtitle: '书签',
        score: 0.4
      }),
      stub({
        domain: 'tile',
        id: 'uuid-2',
        title: '书签',
        subtitle: '书签',
        score: 0.9
      })
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('uuid-2')
  })

  it('keeps navigation hits that share title but differ by url subtitle', function () {
    const hits = sortHits([
      stub({
        domain: 'navigation',
        id: '1',
        title: 'GitHub',
        subtitle: 'https://github.com/a'
      }),
      stub({
        domain: 'navigation',
        id: '2',
        title: 'GitHub',
        subtitle: 'https://github.com/b'
      })
    ])
    expect(hits).toHaveLength(2)
  })
})
