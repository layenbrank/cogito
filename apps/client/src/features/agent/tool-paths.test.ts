import { describe, expect, it } from 'vitest'

import {
  collectToolPaths,
  findArgPath,
  isFileMutationTool,
  normalizeToolPath
} from './tool-paths.ts'

describe('isFileMutationTool', function () {
  it('认写文件工具，排除 shell / memory', function () {
    expect(isFileMutationTool('write_file')).toBe(true)
    expect(isFileMutationTool('str_replace')).toBe(true)
    expect(isFileMutationTool('text_editor')).toBe(true)
    expect(isFileMutationTool('shell')).toBe(false)
    expect(isFileMutationTool('memory_write')).toBe(false)
    expect(isFileMutationTool('read_file')).toBe(false)
  })
})

describe('findArgPath / normalizeToolPath', function () {
  it('优先取 filePath / path', function () {
    expect(findArgPath({ filePath: 'a.ts', path: 'b.ts' })).toBe('a.ts')
    expect(findArgPath({ path: 'src/x.ts' })).toBe('src/x.ts')
    expect(findArgPath({ command: 'ls' })).toBe(null)
  })

  it('绝对路径压成相对', function () {
    expect(normalizeToolPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(normalizeToolPath('src/a.ts', '/repo')).toBe('src/a.ts')
    expect(normalizeToolPath('/other/a.ts', '/repo')).toBe(null)
  })
})

describe('collectToolPaths', function () {
  it('只收改文件工具的路径并去重', function () {
    const hits = collectToolPaths(
      [
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolName: 'write_file', args: { path: 'a.ts' } },
            { type: 'tool-call', toolName: 'shell', args: { path: 'cwd' } },
            { type: 'tool-call', toolName: 'str_replace', args: { path: 'a.ts' } },
            { type: 'tool-call', toolName: 'edit', args: { filePath: 'b.ts' } }
          ]
        } as never
      ],
      null
    )
    expect(hits.map(function (hit) {
      return hit.path
    })).toEqual(['a.ts', 'b.ts'])
  })
})
