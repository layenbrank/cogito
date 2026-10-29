import { describe, expect, it } from 'vitest'

import { DirectiveContentSchema } from '@/shared/ipc/specs/sidecar'

import { makeDirective, findFreeName } from '@/views/directive/model/draft.ts'

describe('makeDirective', function () {
  it('produces a skeleton the host-side contract accepts', function () {
    const actual = makeDirective('untitled')

    expect(actual.name).toBe('untitled')
    expect(actual.steps).toEqual([])
    expect(DirectiveContentSchema.safeParse(actual).success).toBe(true)
  })
})

describe('findFreeName', function () {
  it('uses the bare name while it is free', function () {
    expect(findFreeName(['build-intern'])).toBe('untitled')
  })

  it('numbers up from the first free slot', function () {
    expect(findFreeName(['untitled', 'untitled-2', 'untitled-4'])).toBe('untitled-3')
  })

  it('skips past a contiguous block', function () {
    expect(findFreeName(['untitled', 'untitled-2', 'untitled-3'])).toBe('untitled-4')
  })
})
