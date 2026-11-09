import { describe, expect, it, vi } from 'vitest'

import { findBoundaryAllowed, matchToken } from './composer-trigger'
import type { ComposerTrigger, ComposerTriggerApi, ComposerTriggerItem } from './composer-trigger'

function buildTrigger(
  id: string,
  token: string,
  extra?: Partial<ComposerTrigger>
): ComposerTrigger {
  return {
    id,
    token,
    resolve: async function () {
      return []
    },
    onSelect: vi.fn(),
    ...extra
  }
}

const MENTION = buildTrigger('mention', '@')
const SLASH = buildTrigger('slash', '/')
const DOUBLE_AT = buildTrigger('double', '@@')

describe('findBoundaryAllowed', function () {
  it('行首允许', function () {
    expect(findBoundaryAllowed(undefined)).toBe(true)
  })

  it('空白与中文标点允许', function () {
    expect(findBoundaryAllowed(' ')).toBe(true)
    expect(findBoundaryAllowed('，')).toBe(true)
    expect(findBoundaryAllowed('（')).toBe(true)
  })

  it('词字符不允许', function () {
    expect(findBoundaryAllowed('a')).toBe(false)
    expect(findBoundaryAllowed('.')).toBe(false)
    expect(findBoundaryAllowed('-')).toBe(false)
  })
})

describe('matchToken', function () {
  it('行首命中，query 为空', function () {
    const matched = matchToken('@', 1, [MENTION])
    expect(matched).toMatchObject({ query: '', start: 0, end: 1 })
    expect(matched?.trigger.id).toBe('mention')
  })

  it('带 query 命中', function () {
    expect(matchToken('看 @brow', 7, [MENTION])).toMatchObject({ query: 'brow', start: 2, end: 7 })
  })

  it('光标在 token 之前不命中', function () {
    expect(matchToken('abc @x', 0, [MENTION])).toBeNull()
  })

  it('query 中出现空白后不再命中', function () {
    expect(matchToken('@a b', 4, [MENTION])).toBeNull()
  })

  it('紧跟词字符时不命中', function () {
    expect(matchToken('a@b', 3, [MENTION])).toBeNull()
  })

  it('多字符 token 优先于单字符', function () {
    const matched = matchToken('@@x', 3, [MENTION, DOUBLE_AT])
    expect(matched?.trigger.id).toBe('double')
    expect(matched?.query).toBe('x')
  })

  it('只有单个 @ 时回落到单字符 token', function () {
    const matched = matchToken('@x', 2, [MENTION, DOUBLE_AT])
    expect(matched?.trigger.id).toBe('mention')
  })

  it('多字符 token 可以自定义边界', function () {
    const strict = buildTrigger('strict', '::', { boundary: (previous) => previous === ' ' })
    expect(matchToken('a::b', 4, [strict])).toBeNull()
    expect(matchToken(' ::b', 4, [strict])).toMatchObject({ query: 'b', start: 1, end: 4 })
  })

  it('多个 token 互不干扰', function () {
    expect(matchToken('/skill', 6, [MENTION, SLASH])?.trigger.id).toBe('slash')
    expect(matchToken('@file', 5, [MENTION, SLASH])?.trigger.id).toBe('mention')
  })

  it('未注册的字符不命中', function () {
    expect(matchToken('#tag', 4, [MENTION, SLASH])).toBeNull()
  })

  it('取离光标最近的那个 token', function () {
    expect(matchToken('@a @b', 5, [MENTION])).toMatchObject({ query: 'b', start: 3, end: 5 })
  })
})

describe('ComposerTriggerApi 形状', function () {
  it('onSelect 能拿到完整的动作面', async function () {
    const captured: ComposerTriggerApi[] = []
    const trigger: ComposerTrigger = {
      id: 'probe',
      token: '@',
      resolve: async function (): Promise<readonly ComposerTriggerItem[]> {
        return [{ id: 'a', label: 'A' }]
      },
      onSelect: function (_item, api) {
        captured.push(api)
      }
    }
    const matched = matchToken('@', 1, [trigger])
    expect(matched).not.toBeNull()
    const api = {
      insertChip: vi.fn(),
      insertText: vi.fn(),
      removeToken: vi.fn(),
      complete: vi.fn(),
      query: '',
      close: vi.fn()
    }
    matched?.trigger.onSelect({ id: 'a', label: 'A' }, api)
    expect(captured[0]).toBe(api)
  })
})
