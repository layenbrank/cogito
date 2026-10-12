import { describe, expect, it } from 'vitest'

import { findServedRange, isNotModified, isRangeStillValid } from './conditional.ts'

const ETAG = '"3eaf2c9512f76a55da265ad51ac21393-1"'
const UPLOADED = new Date('2026-01-02T03:04:05.000Z')
const object = { httpEtag: ETAG, uploaded: UPLOADED }

function findRequest(headers: Record<string, string>): Request {
  return new Request('https://downloads.example/1.3.0/x-setup.exe', { headers })
}

describe('isNotModified（RFC 7232 的缓存再验证）', function () {
  it('没有条件头时不算「没变」', function () {
    expect(isNotModified(findRequest({}), object)).toBe(false)
  })

  it('If-None-Match 命中（含弱标记、多值、通配）', function () {
    expect(isNotModified(findRequest({ 'If-None-Match': ETAG }), object)).toBe(true)
    expect(isNotModified(findRequest({ 'If-None-Match': `W/${ETAG}` }), object)).toBe(true)
    expect(isNotModified(findRequest({ 'If-None-Match': `"other", ${ETAG}` }), object)).toBe(true)
    expect(isNotModified(findRequest({ 'If-None-Match': '*' }), object)).toBe(true)
  })

  it('If-None-Match 不命中时照常给 body', function () {
    expect(isNotModified(findRequest({ 'If-None-Match': '"other"' }), object)).toBe(false)
  })

  it('If-Match 在场时归 412 那条路，不算「没变」', function () {
    expect(
      isNotModified(findRequest({ 'If-Match': '"other"', 'If-None-Match': ETAG }), object)
    ).toBe(false)
  })

  it('If-Modified-Since 按秒级精度比（对象不比它新就算没变）', function () {
    expect(
      isNotModified(findRequest({ 'If-Modified-Since': 'Fri, 02 Jan 2026 03:04:05 GMT' }), object)
    ).toBe(true)
    expect(
      isNotModified(findRequest({ 'If-Modified-Since': 'Thu, 01 Jan 2026 00:00:00 GMT' }), object)
    ).toBe(false)
    expect(isNotModified(findRequest({ 'If-Modified-Since': 'not-a-date' }), object)).toBe(false)
  })

  it('对象没有 uploaded 时只看 etag', function () {
    expect(
      isNotModified(findRequest({ 'If-Modified-Since': 'Fri, 02 Jan 2026 03:04:05 GMT' }), {
        httpEtag: ETAG
      })
    ).toBe(false)
  })
})

describe('isRangeStillValid（RFC 7233 的 If-Range，R2 不认这个头）', function () {
  it('etag 相等就按 Range 回', function () {
    expect(isRangeStillValid(ETAG, object)).toBe(true)
    expect(isRangeStillValid(`W/${ETAG}`, object)).toBe(true)
  })

  it('日期不比对象旧时按 Range 回，比对象旧则回整份', function () {
    expect(isRangeStillValid('Fri, 02 Jan 2026 03:04:05 GMT', object)).toBe(true)
    expect(isRangeStillValid('Thu, 01 Jan 2026 00:00:00 GMT', object)).toBe(false)
  })

  it('etag 变了、或值既不是 etag 也不是日期', function () {
    expect(isRangeStillValid('"other"', object)).toBe(false)
    expect(isRangeStillValid('', object)).toBe(false)
  })

  it('对象不存在时不给 Range', function () {
    expect(isRangeStillValid(ETAG, null)).toBe(false)
  })
})

describe('findServedRange（206 的字节窗口）', function () {
  it('不是分片请求就回 null（R2 每次读都带 range，不能只看它）', function () {
    expect(findServedRange({ size: 100, range: { offset: 0, length: 100 } }, false)).toBe(null)
  })

  it('offset + length', function () {
    expect(findServedRange({ size: 100, range: { offset: 10, length: 20 } }, true)).toEqual({
      offset: 10,
      length: 20
    })
  })

  it('只给 offset 时补到对象末尾', function () {
    expect(findServedRange({ size: 100, range: { offset: 90 } }, true)).toEqual({
      offset: 90,
      length: 10
    })
  })

  it('suffix 取末尾若干字节，超过对象长度就夹住', function () {
    expect(findServedRange({ size: 100, range: { offset: 0, suffix: 10 } }, true)).toEqual({
      offset: 90,
      length: 10
    })
    expect(findServedRange({ size: 100, range: { offset: 0, suffix: 500 } }, true)).toEqual({
      offset: 0,
      length: 100
    })
  })

  it('空窗口（越界的 offset）回 null', function () {
    expect(findServedRange({ size: 100, range: { offset: 100 } }, true)).toBe(null)
  })
})
