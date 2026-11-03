import { describe, expect, it } from 'vitest'

import {
  isPrivateNetworkHost,
  parseImportUrls
} from '@/views/knowledge/lib/url-source-import.ts'

describe('parseImportUrls', function () {
  it('去重并限制协议', function () {
    expect(
      parseImportUrls('https://a.com/x\nhttps://a.com/x\nhttps://b.com/y')
    ).toEqual(['https://a.com/x', 'https://b.com/y'])
  })

  it('拒绝凭据与过多条目', function () {
    expect(function () {
      parseImportUrls('https://user:pass@evil.com')
    }).toThrow()
  })
})

describe('isPrivateNetworkHost', function () {
  it('识别常见私网', function () {
    expect(isPrivateNetworkHost('127.0.0.1')).toBe(true)
    expect(isPrivateNetworkHost('10.0.0.1')).toBe(true)
    expect(isPrivateNetworkHost('192.168.1.1')).toBe(true)
    expect(isPrivateNetworkHost('example.com')).toBe(false)
  })
})
