import { describe, expect, it } from 'vitest'

import { formatAddress, formatTabTitle, isAddressDirty, normalizeAddressKey, parseAddress } from './address'

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

describe('normalizeAddressKey / isAddressDirty', function () {
  it('尾部斜杠不算改动', function () {
    expect(normalizeAddressKey('https://a.test/')).toBe('https://a.test')
    expect(isAddressDirty('https://a.test/', 'https://a.test')).toBe(false)
  })

  it('换了路径就算改动（决定按钮是「前往」还是「刷新」）', function () {
    expect(isAddressDirty('https://a.test/b', 'https://a.test/a')).toBe(true)
    expect(isAddressDirty('', 'https://a.test/a')).toBe(false)
  })

  it('hash 保留：只改 hash 必须算改动', function () {
    expect(normalizeAddressKey('https://a.test/doc#x')).toBe('https://a.test/doc#x')
    expect(isAddressDirty('https://a.test/doc#x', 'https://a.test/doc')).toBe(true)
  })
})

describe('formatTabTitle', function () {
  it('有标题时优先用标题', function () {
    expect(formatTabTitle('https://example.com/a', 'Example Domain')).toBe('Example Domain')
    expect(formatTabTitle('https://example.com/a', '  ')).toBe('example.com')
  })

  it('无标题时回退 host', function () {
    expect(formatTabTitle('https://example.com/a/b?c=1')).toBe('example.com')
    expect(formatTabTitle('http://localhost:3000')).toBe('localhost:3000')
  })

  it('空白页与解析失败原样兜底', function () {
    expect(formatTabTitle('about:blank')).toBe('新标签页')
    expect(formatTabTitle('')).toBe('新标签页')
    expect(formatTabTitle('not a url')).toBe('not a url')
  })
})
