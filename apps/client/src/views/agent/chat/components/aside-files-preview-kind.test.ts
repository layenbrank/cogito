import { describe, expect, it } from 'vitest'

import { findAsidePreviewKind, isMediaKind } from '@/views/agent/chat/components/aside-files-preview-kind.ts'

/**
 * 预览分流是「点图片只有一个报错」的根因修复点：判错类型会让 Monaco 去解码二进制。
 */
describe('右栏预览按类型分流', function () {
  it('图片（含大写扩展名与子目录）走 image', function () {
    expect(findAsidePreviewKind('assets/logo.png')).toBe('image')
    expect(findAsidePreviewKind('截图/首页.JPG')).toBe('image')
    expect(findAsidePreviewKind('a.webp')).toBe('image')
    expect(findAsidePreviewKind('a.avif')).toBe('image')
  })

  it('音视频各自分流', function () {
    expect(findAsidePreviewKind('media/demo.mp4')).toBe('video')
    expect(findAsidePreviewKind('media/demo.mov')).toBe('video')
    expect(findAsidePreviewKind('media/voice.mp3')).toBe('audio')
    expect(findAsidePreviewKind('media/voice.flac')).toBe('audio')
  })

  it('svg 仍是文本：能编辑，不锁成图片', function () {
    expect(findAsidePreviewKind('icons/logo.svg')).toBe('text')
  })

  it('其余二进制只给「用默认应用打开」', function () {
    expect(findAsidePreviewKind('docs/manual.pdf')).toBe('binary')
    expect(findAsidePreviewKind('dist/app.zip')).toBe('binary')
    expect(findAsidePreviewKind('build/app.exe')).toBe('binary')
  })

  it('源码 / 无扩展名 / 空路径都按文本处理', function () {
    expect(findAsidePreviewKind('src/index.ts')).toBe('text')
    expect(findAsidePreviewKind('Makefile')).toBe('text')
    expect(findAsidePreviewKind('.gitignore')).toBe('text')
    expect(findAsidePreviewKind(null)).toBe('text')
  })

  it('isMediaKind 只认三种媒体类型', function () {
    expect(isMediaKind('image')).toBe(true)
    expect(isMediaKind('audio')).toBe(true)
    expect(isMediaKind('video')).toBe(true)
    expect(isMediaKind('text')).toBe(false)
    expect(isMediaKind('binary')).toBe(false)
  })
})
