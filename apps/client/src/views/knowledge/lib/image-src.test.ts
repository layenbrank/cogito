import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', function () {
  return {
    convertFileSrc: function (path: string) {
      return `asset://localhost/${encodeURIComponent(path)}`
    }
  }
})

import { findImageSrc } from './image-src.ts'

describe('findImageSrc', function () {
  it('相对路径按当前文档目录拼成 asset 协议地址', function () {
    const src = findImageSrc('assets/img-1.png', 'D:/notes/note.md')

    expect(src.startsWith('asset://localhost/')).toBe(true)
    expect(decodeURIComponent(src)).toContain('/notes/assets/img-1.png')
  })

  it('绝对磁盘路径直接转 asset 协议', function () {
    const src = findImageSrc('D:/pics/a.png', null)

    expect(decodeURIComponent(src)).toBe('asset://localhost/D:/pics/a.png')
  })

  it('远程 / data / 已解析地址原样返回', function () {
    expect(findImageSrc('https://example.com/a.png', 'D:/notes/note.md')).toBe(
      'https://example.com/a.png'
    )
    expect(findImageSrc('data:image/png;base64,AAA', 'D:/notes/note.md')).toBe(
      'data:image/png;base64,AAA'
    )
    expect(findImageSrc('asset://localhost/x.png', 'D:/notes/note.md')).toBe(
      'asset://localhost/x.png'
    )
  })

  it('没有当前文档时保留相对路径', function () {
    expect(findImageSrc('assets/img-1.png', null)).toBe('assets/img-1.png')
  })
})
