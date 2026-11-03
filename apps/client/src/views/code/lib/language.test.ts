import { describe, expect, it } from 'vitest'

import { buildLanguageIndex, findLanguageId } from '@/views/code/lib/language.ts'

describe('findLanguageId', function () {
  it('补齐计划里点名的扩展名', function () {
    expect(findLanguageId('a.mts')).toBe('typescript')
    expect(findLanguageId('b.cts')).toBe('typescript')
    expect(findLanguageId('x.graphql')).toBe('graphql')
    expect(findLanguageId('x.kt')).toBe('kotlin')
    expect(findLanguageId('x.lua')).toBe('lua')
    expect(findLanguageId('x.proto')).toBe('proto')
    expect(findLanguageId('x.ini')).toBe('ini')
    expect(findLanguageId('x.http')).toBe('http')
  })

  it('无扩展名文件按文件名识别', function () {
    expect(findLanguageId('Dockerfile')).toBe('dockerfile')
    expect(findLanguageId('C:/repo/Makefile')).toBe('makefile')
  })

  it('覆盖表优先于注册表语义', function () {
    expect(findLanguageId('App.vue')).toBe('html')
    expect(findLanguageId('Cargo.toml')).toBe('ini')
    expect(findLanguageId('page.mdx')).toBe('markdown')
  })

  it('未知扩展名回落 plaintext', function () {
    expect(findLanguageId('x.unknownext')).toBe('plaintext')
  })

  it('monaco 未加载时不抛错（走手写表）', function () {
    expect(findLanguageId('src/a.ts')).toBe('typescript')
    expect(findLanguageId('src/a.tsx')).toBe('typescript')
  })
})

describe('buildLanguageIndex', function () {
  it('折叠 extensions / filenames，首个注册者优先', function () {
    const built = buildLanguageIndex([
      { id: 'typescript', extensions: ['.ts', '.mts'] },
      { id: 'javascript', extensions: ['.js', 'ts'] },
      { id: 'dockerfile', filenames: ['Dockerfile'] }
    ])
    expect(built.byExtension.get('ts')).toBe('typescript')
    expect(built.byExtension.get('mts')).toBe('typescript')
    expect(built.byExtension.get('js')).toBe('javascript')
    expect(built.byFilename.get('dockerfile')).toBe('dockerfile')
  })
})
