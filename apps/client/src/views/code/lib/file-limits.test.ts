import { describe, expect, it } from 'vitest'

import { hasBinaryExtension, isLargeDocument, looksBinary } from './file-limits.ts'

describe('hasBinaryExtension', function () {
  it('常见二进制后缀被识别', function () {
    expect(hasBinaryExtension('D:/repo/logo.PNG')).toBe(true)
    expect(hasBinaryExtension('D:/repo/archive.tar')).toBe(true)
    expect(hasBinaryExtension('D:/repo/data.sqlite3')).toBe(true)
  })

  it('源码与文本后缀放行', function () {
    expect(hasBinaryExtension('D:/repo/main.ts')).toBe(false)
    expect(hasBinaryExtension('D:/repo/Dockerfile')).toBe(false)
    expect(hasBinaryExtension('D:/repo/.gitignore')).toBe(false)
  })
})

describe('looksBinary', function () {
  it('头部出现 NUL 视为二进制', function () {
    expect(looksBinary('abc\u0000def')).toBe(true)
  })

  it('纯文本不误判', function () {
    expect(looksBinary('# 标题\n正文')).toBe(false)
  })
})

describe('isLargeDocument', function () {
  function documentOf(valueLength: number, lineCount: number) {
    return {
      getValueLength() {
        return valueLength
      },
      getLineCount() {
        return lineCount
      }
    }
  }

  it('体量超过只读阈值即视为大文件', function () {
    expect(isLargeDocument(documentOf(2 * 1024 * 1024 + 1, 10))).toBe(true)
  })

  it('行数过多同样视为大文件', function () {
    expect(isLargeDocument(documentOf(1024, 50_000))).toBe(true)
  })

  it('正常文件不触发', function () {
    expect(isLargeDocument(documentOf(64 * 1024, 800))).toBe(false)
  })
})
