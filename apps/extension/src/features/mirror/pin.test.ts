import { describe, expect, it } from 'vitest'

import { canPin, clipTitle } from './pin'

describe('canPin', function () {
  it('只接受 http(s)', function () {
    expect(canPin('https://example.com')).toBe(true)
    expect(canPin('http://localhost:1024')).toBe(true)
    expect(canPin('chrome://extensions')).toBe(false)
    expect(canPin(undefined)).toBe(false)
  })
})

describe('clipTitle', function () {
  it('空标题退回主机名', function () {
    expect(clipTitle('  ', 'https://news.example.com/a')).toBe('news.example.com')
  })

  it('过长标题截断', function () {
    expect(clipTitle('啊'.repeat(100), 'https://example.com').length).toBe(80)
  })
})
