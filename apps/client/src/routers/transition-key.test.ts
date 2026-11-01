import { describe, expect, it } from 'vitest'

import { findTransitionKey } from './transition-key.ts'

interface MatchStub {
  id: string
  route: { path?: string }
}

describe('findTransitionKey', function () {
  it('keys sibling children under an app layout to the same app route', function () {
    const shell: MatchStub[] = [
      { id: 'host', route: {} },
      { id: 'transition', route: {} },
      { id: 'capture', route: { path: '/capture' } }
    ]

    expect(
      findTransitionKey([
        ...shell,
        { id: 'capture-index', route: {} }
      ])
    ).toBe('capture')

    expect(
      findTransitionKey([
        ...shell,
        { id: 'capture-recording', route: { path: 'recording' } }
      ])
    ).toBe('capture')
  })

  it('still distinguishes different top-level apps', function () {
    expect(
      findTransitionKey([
        { id: 'host', route: {} },
        { id: 'gallery', route: { path: '/gallery' } }
      ])
    ).toBe('gallery')

    expect(
      findTransitionKey([
        { id: 'host', route: {} },
        { id: 'capture', route: { path: '/capture' } }
      ])
    ).toBe('capture')
  })

  it('falls back to deepest match when no absolute app path exists', function () {
    expect(
      findTransitionKey([
        { id: 'host', route: {} },
        { id: 'leaf', route: { path: 'relative' } }
      ])
    ).toBe('leaf')
  })
})
