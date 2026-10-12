import { describe, expect, it } from 'vitest'

import type { ImportResult } from '@/shared/ipc/specs/sidecar'

import {
  formatImportSummary,
  importFailure,
  importNames,
  joinNames,
  mergeImportResults,
  NAMED_LIMIT
} from './import.ts'

type Status = 'created' | 'updated' | 'skipped' | 'failed'

/** 计数从条目推出来，测试只管写条目 */
function makeResult(
  entries: readonly { name: string; status: Status; path?: string }[]
): ImportResult {
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 }
  entries.forEach(function (entry) {
    counts[entry.status] += 1
  })
  return {
    entries: entries.map(function (entry) {
      return { name: entry.name, path: entry.path ?? `${entry.name}.yaml`, status: entry.status }
    }),
    created: counts.created,
    updated: counts.updated,
    skipped: counts.skipped,
    failed: counts.failed
  }
}

describe('mergeImportResults', function () {
  it('adds up the four counters and keeps every entry', function () {
    const merged = mergeImportResults([
      makeResult([
        { name: 'a', status: 'created' },
        { name: 'b', status: 'skipped' }
      ]),
      makeResult([
        { name: 'b', status: 'updated' },
        { name: 'c', status: 'failed' }
      ])
    ])

    expect(merged).toMatchObject({ created: 1, updated: 1, skipped: 1, failed: 1 })
    expect(
      merged.entries.map(function (entry) {
        return entry.name
      })
    ).toEqual(['a', 'b', 'b', 'c'])
  })

  it('is all zeros for an empty batch', function () {
    expect(mergeImportResults([])).toEqual({
      entries: [],
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    })
  })
})

describe('importFailure', function () {
  it('names the file so a blown-up path is not swallowed', function () {
    const failed = importFailure('C:\\lib\\nightly.yaml', new Error('sidecar 断了'))

    expect(failed.failed).toBe(1)
    expect(failed.entries[0]).toEqual({
      name: 'nightly.yaml',
      path: 'C:\\lib\\nightly.yaml',
      status: 'failed',
      error: 'sidecar 断了'
    })
  })

  it('accepts a non-Error throw', function () {
    expect(importFailure('/lib/a.yaml', 'boom').entries[0]?.error).toBe('boom')
  })
})

describe('importNames', function () {
  it('keeps only the asked-for status', function () {
    const result = makeResult([
      { name: 'a', status: 'created' },
      { name: 'b', status: 'skipped' },
      { name: 'c', status: 'skipped' }
    ])

    expect(importNames(result, 'skipped')).toEqual(['b', 'c'])
    expect(importNames(result, 'failed')).toEqual([])
  })
})

describe('formatImportSummary', function () {
  it('drops 失败 when nothing failed', function () {
    const summary = formatImportSummary(
      makeResult([
        { name: 'a', status: 'created' },
        { name: 'b', status: 'skipped' }
      ])
    )

    expect(summary).toBe('新建 1，更新 0，跳过 1')
  })

  it('reports 失败 when something did', function () {
    const summary = formatImportSummary(makeResult([{ name: 'a', status: 'failed' }]))

    expect(summary).toBe('新建 0，更新 0，跳过 0，失败 1')
  })
})

describe('joinNames', function () {
  it('lists them all while the list is short', function () {
    expect(joinNames(['a', 'b'])).toBe('a、b')
  })

  it('folds a long list into a count', function () {
    const names = Array.from({ length: NAMED_LIMIT + 2 }, function (_, index) {
      return `n${index}`
    })

    expect(joinNames(names)).toBe(`n0、n1、n2、n3、n4、n5、n6、n7 等 ${NAMED_LIMIT + 2} 个`)
  })
})
