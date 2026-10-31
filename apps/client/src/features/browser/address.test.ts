import { describe, expect, it } from 'vitest'

import { formatAddress, formatTabTitle, parseAddress } from './address'

describe('parseAddress', function () {
  it('带 scheme 原样返回', function () {
    expect(parseAddress('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(parseAddress('about:blank')).toBe('about:blank')
    expect(parseAddress('file:///d:/tmp/a.html')).toBe('file:///d:/tmp/a.html')
  })

  it('本地回环与裸 IP 走 http', function () {
    expect(parseAddress('localhost:3000')).toBe('http://localhost:3000')
    expect(parseAddress('127.0.0.1:8080/docs')).toBe('http://127.0.0.1:8080/docs')
    expect(parseAddress('192.168.1.10')).toBe('http://192.168.1.10')
    expect(parseAddress('[::1]:5173')).toBe('http://[::1]:5173')
  })

  it('其余补 https（不猜搜索词）', function () {
    expect(parseAddress('example.com')).toBe('https://example.com')
    expect(parseAddress('  github.com/a/b  ')).toBe('https://github.com/a/b')
    expect(parseAddress('foo bar')).toBe('https://foo bar')
  })

  it('空输入返回空串，交给调用方决定兜底页', function () {
    expect(parseAddress('')).toBe('')
    expect(parseAddress('   ')).toBe('')
  })
})

describe('formatAddress', function () {
  it('空白页不给地址栏塞 about:blank', function () {
    expect(formatAddress('about:blank')).toBe('')
    expect(formatAddress('https://example.com')).toBe('https://example.com')
  })
})

describe('formatTabTitle', function () {
  it('优先显示 host', function () {
    expect(formatTabTitle('https://example.com/a/b?c=1')).toBe('example.com')
    expect(formatTabTitle('http://localhost:3000')).toBe('localhost:3000')
  })

  it('空白页与解析失败原样兜底', function () {
    expect(formatTabTitle('about:blank')).toBe('新标签页')
    expect(formatTabTitle('')).toBe('新标签页')
    expect(formatTabTitle('not a url')).toBe('not a url')
  })
})
