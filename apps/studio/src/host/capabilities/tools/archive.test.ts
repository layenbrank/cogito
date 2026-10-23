import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { findArchiveKind, findFileInTree } from './archive'

describe('findArchiveKind', function () {
  it('recognizes the archives the pinned tools come in', function () {
    expect(findArchiveKind('pandoc-3.6.4-windows-x86_64.zip')).toBe('.zip')
    expect(findArchiveKind('pandoc-3.6.4-linux-amd64.tar.gz')).toBe('.tar.gz')
    expect(findArchiveKind('ffmpeg-N-126965-linux64-gpl.tar.xz')).toBe('.tar.xz')
    expect(findArchiveKind('ffmpeg.zip.tar.gz')).toBe('.tar.gz')
  })

  it('rejects anything else', function () {
    expect(findArchiveKind('pandoc.exe')).toBeNull()
    expect(findArchiveKind('archive.7z')).toBeNull()
  })
})

describe('findFileInTree', function () {
  const roots: string[] = []

  function buildTree(): string {
    const root = path.join(os.tmpdir(), `cogito-tools-${process.pid}-${roots.length}`)
    rmSync(root, { recursive: true, force: true })
    mkdirSync(path.join(root, 'pandoc-3.6.4', 'bin'), { recursive: true })
    writeFileSync(path.join(root, 'pandoc-3.6.4', 'bin', 'pandoc.exe'), 'binary')
    mkdirSync(path.join(root, 'extras'), { recursive: true })
    writeFileSync(path.join(root, 'extras', 'readme.txt'), 'text')
    roots.push(root)
    return root
  }

  afterEach(function () {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('finds a file at any depth', function () {
    const root = buildTree()
    expect(findFileInTree(root, 'pandoc.exe')).toBe(
      path.join(root, 'pandoc-3.6.4', 'bin', 'pandoc.exe')
    )
  })

  it('returns undefined when the file is not in the archive', function () {
    const root = buildTree()
    expect(findFileInTree(root, 'ffmpeg.exe')).toBeUndefined()
  })
})
