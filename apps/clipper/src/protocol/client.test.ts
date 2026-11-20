import { describe, expect, it } from 'vitest'

import { clipEndpoint, orderPorts } from './client.ts'
import { CLIP_PORT_ISOLATED, CLIP_PORT_RELEASE } from './constants.ts'
import { formatDelivery, parsePayload } from './payload.ts'

describe('clip protocol', function () {
  it('prefers the isolated port only after it has answered', function () {
    expect(orderPorts(null)).toEqual([CLIP_PORT_RELEASE, CLIP_PORT_ISOLATED])
    expect(orderPorts(CLIP_PORT_ISOLATED)).toEqual([CLIP_PORT_ISOLATED, CLIP_PORT_RELEASE])
  })

  it('keeps the clip URL on the release port', function () {
    expect(clipEndpoint(CLIP_PORT_RELEASE)).toBe('http://127.0.0.1:19828/clip')
  })

  it('rejects a partial payload', function () {
    expect(parsePayload({ title: 'a', url: 'https://a' })).toBeNull()
  })

  it('formats the previous status lines', function () {
    expect(formatDelivery({ ok: true, status: 200 })).toBe('已发送 (200)')
    expect(formatDelivery({ ok: false, error: 'down' })).toBe('失败：down')
  })
})
