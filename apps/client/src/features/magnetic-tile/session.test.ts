import { describe, expect, it } from 'vitest'

import { trimSessions, type TileSession } from '@/features/magnetic-tile/session'

function session(component: MagneticTile.Component): TileSession {
  return { component, tileId: component, url: '', path: `/${component}` }
}

describe('trimSessions', function () {
  it('keeps the foreground app and only three background apps', function () {
    const current = [
      session('calendar'),
      session('markdown'),
      session('agent'),
      session('gallery'),
      session('code')
    ]
    const trimmed = trimSessions(current, 'calendar', false)
    expect(trimmed.map(function (item) {
      return item.component
    })).toEqual(['calendar', 'markdown', 'agent', 'gallery'])
  })

  it('keeps a dirty markdown session past the background cap', function () {
    const current = [
      session('calendar'),
      session('agent'),
      session('gallery'),
      session('code'),
      session('markdown')
    ]
    const trimmed = trimSessions(current, 'calendar', true)
    expect(trimmed.map(function (item) {
      return item.component
    })).toEqual(['calendar', 'agent', 'gallery', 'code', 'markdown'])
  })
})
