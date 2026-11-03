import { describe, expect, it, vi } from 'vitest'

import {
  mergeTsconfig,
  readTsconfigChain,
  resolveBaseUrl,
  resolveExtendsPath,
  toCompilerOptions
} from '@/views/code/lib/tsconfig.ts'

const files = new Map<string, string>()

vi.mock('@/lib/workspace-files', function () {
  return {
    WorkspaceFiles: {
      readFile: async function (_roots: string[], path: string) {
        const content = files.get(path.replace(/\\/g, '/'))
        if (content === undefined) throw new Error(`ENOENT ${path}`)
        return { path, content }
      }
    }
  }
})

const ENUMS = {
  target: { ES2020: 7, ESNEXT: 99 },
  module: { ESNEXT: 99 },
  moduleResolution: { BUNDLER: 100, NODEJS: 2 },
  jsx: { REACTJSX: 4 }
}

describe('readTsconfigChain', function () {
  it('沿 extends 链合并，子配置覆盖父配置', async function () {
    files.clear()
    files.set(
      'C:/repo/tsconfig.base.json',
      `{
        // 父配置
        "compilerOptions": { "target": "ES2020", "strict": false, "paths": { "@/*": ["./src/*"] } }
      }`
    )
    files.set(
      'C:/repo/tsconfig.json',
      `{
        "extends": "./tsconfig.base.json",
        "compilerOptions": { "strict": true, "jsx": "react-jsx" }
      }`
    )
    const chain = await readTsconfigChain(['C:/repo'])
    expect(chain?.compilerOptions).toEqual({
      target: 'ES2020',
      strict: true,
      jsx: 'react-jsx',
      paths: { '@/*': ['./src/*'] }
    })
  })

  it('extends 指向 node_modules 包', async function () {
    files.clear()
    files.set('C:/repo/node_modules/@tsconfig/node24/tsconfig.json', '{"compilerOptions":{"module":"esnext"}}')
    files.set('C:/repo/tsconfig.json', '{"extends":"@tsconfig/node24/tsconfig.json"}')
    const chain = await readTsconfigChain(['C:/repo'])
    expect(chain?.compilerOptions?.module).toBe('esnext')
  })

  it('环检测不会无限递归', async function () {
    files.clear()
    files.set('C:/repo/tsconfig.json', '{"extends":"./tsconfig.other.json"}')
    files.set('C:/repo/tsconfig.other.json', '{"extends":"./tsconfig.json"}')
    const chain = await readTsconfigChain(['C:/repo'])
    expect(chain).not.toBeUndefined()
  })
})

describe('toCompilerOptions', function () {
  it('映射白名单枚举，未知字段忽略', function () {
    const options = toCompilerOptions(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'esnext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          lib: ['ES2020', 'DOM'],
          unknownFlag: true
        }
      },
      { rootPath: 'C:/repo', base: {}, enums: ENUMS }
    )
    expect(options.target).toBe(7)
    expect(options.module).toBe(99)
    expect(options.moduleResolution).toBe(100)
    expect(options.jsx).toBe(4)
    expect(options.lib).toEqual(['ES2020', 'DOM'])
    expect('unknownFlag' in options).toBe(false)
  })

  it('paths 透传，baseUrl 转 file:/// URI', function () {
    const options = toCompilerOptions(
      { compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } },
      { rootPath: 'C:/repo', base: {}, enums: ENUMS }
    )
    expect(options.baseUrl).toBe('file:///C:/repo')
    expect(options.paths).toEqual({ '@/*': ['./src/*'] })
  })

  it('空 tsconfig 返回空补丁', function () {
    expect(toCompilerOptions(null, { rootPath: 'C:/repo', base: {}, enums: ENUMS })).toEqual({})
  })
})

describe('辅助纯函数', function () {
  it('resolveExtendsPath 处理相对路径与包名', function () {
    expect(resolveExtendsPath('tsconfig.json', './base.json')).toBe('base.json')
    expect(resolveExtendsPath('packages/a/tsconfig.json', '../tsconfig.base.json')).toBe(
      'packages/tsconfig.base.json'
    )
    expect(resolveExtendsPath('tsconfig.json', '@tsconfig/node24')).toBe(
      'node_modules/@tsconfig/node24/tsconfig.json'
    )
  })

  it('resolveBaseUrl 输出 file:/// 开头', function () {
    expect(resolveBaseUrl('C:/repo', './src')).toBe('file:///C:/repo/src')
  })

  it('mergeTsconfig 浅合并 compilerOptions', function () {
    expect(
      mergeTsconfig(
        { compilerOptions: { target: 'ES2020', paths: { a: ['x'] } } },
        { compilerOptions: { paths: { b: ['y'] } } }
      )
    ).toEqual({ compilerOptions: { target: 'ES2020', paths: { b: ['y'] } } })
  })
})
