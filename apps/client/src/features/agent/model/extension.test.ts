import { describe, expect, it } from 'vitest'

import {
  buildExtension,
  makeExtensionDraft,
  describeExtension,
  findExtensionKey,
  findExtensionName,
  parseLines,
  parsePairs,
  type ExtensionDraft,
  type ExtensionEntry
} from '@/features/agent/model/extension.ts'

/**
 * 表单文本 → 线格式的账：goose 的扩展载荷形状（`type` 判别联合 + `{name,value}` 列表）
 * 改了就应在这里先红，而不是提交时被 goose 用 invalid params 打回。
 */

function draft(patch: Partial<ExtensionDraft>): ExtensionDraft {
  return { ...makeExtensionDraft(), ...patch }
}

describe('parseLines', function () {
  it('跳过空行与 # 注释', function () {
    expect(parseLines('  --flag \n\n# 说明\nvalue')).toEqual(['--flag', 'value'])
  })
})

describe('parsePairs', function () {
  it('只按第一个分隔符拆，值里再出现分隔符不拆', function () {
    expect(parsePairs('Authorization: Bearer a:b', ':')).toEqual([
      { name: 'Authorization', value: 'Bearer a:b' }
    ])
    expect(parsePairs('TOKEN=a=b', '=')).toEqual([{ name: 'TOKEN', value: 'a=b' }])
  })

  it('缺少分隔符时报错而不是静默丢弃', function () {
    expect(function () {
      parsePairs('没有分隔符', ':')
    }).toThrow('缺少「:」分隔符')
  })
})

describe('buildExtension', function () {
  it('http：带上 url 与请求头', function () {
    const extension = buildExtension(
      draft({
        kind: 'http',
        name: ' cogito ',
        url: 'https://example.com/api/v1/mcp',
        headers: 'X-Tenant-ID: t1',
        description: ' 平台 MCP '
      })
    )
    expect(extension).toEqual({
      type: 'mcp',
      server: {
        type: 'http',
        name: 'cogito',
        url: 'https://example.com/api/v1/mcp',
        headers: [{ name: 'X-Tenant-ID', value: 't1' }]
      },
      description: '平台 MCP'
    })
  })

  it('stdio：参数按行、环境变量按 KEY=VALUE，缺描述时给 null', function () {
    const extension = buildExtension(
      draft({
        kind: 'stdio',
        name: 'corex',
        command: 'D:/bin/corex-mcp.exe',
        args: '--data-dir\nD:/data',
        env: 'COREX_DATA_DIR=D:/data'
      })
    )
    expect(extension).toEqual({
      type: 'mcp',
      server: {
        type: 'stdio',
        name: 'corex',
        command: 'D:/bin/corex-mcp.exe',
        args: ['--data-dir', 'D:/data'],
        env: [{ name: 'COREX_DATA_DIR', value: 'D:/data' }]
      },
      description: null
    })
  })

  it('缺必填字段时报错', function () {
    expect(function () {
      buildExtension(draft({ kind: 'http', url: 'https://example.com/mcp' }))
    }).toThrow('请填写扩展名称')
    expect(function () {
      buildExtension(draft({ kind: 'http', name: 'x' }))
    }).toThrow('请填写 MCP 服务地址')
    expect(function () {
      buildExtension(draft({ kind: 'stdio', name: 'x' }))
    }).toThrow('请填写启动命令')
  })
})

describe('findExtensionKey', function () {
  it('优先用 configKey，缺失时退回扩展名', function () {
    const entry: ExtensionEntry = {
      extension: { type: 'mcp', server: { type: 'http', name: 'a', url: 'u', headers: [] }, description: null },
      enabled: true,
      configKey: ' a '
    }
    expect(findExtensionKey(entry)).toBe('a')
    expect(findExtensionKey({ ...entry, configKey: null })).toBe('a')
  })
})

describe('describeExtension', function () {
  it('MCP 显示端点或命令行，内置 / 平台显示类型', function () {
    expect(
      describeExtension({
        type: 'mcp',
        server: { type: 'http', name: 'a', url: 'https://x/mcp', headers: [] },
        description: null
      })
    ).toBe('https://x/mcp')
    expect(
      describeExtension({
        type: 'mcp',
        server: { type: 'stdio', name: 'a', command: 'corex-mcp', args: ['--flag'], env: [] },
        description: null
      })
    ).toBe('corex-mcp --flag')
    expect(describeExtension({ type: 'platform', name: 'summarize' })).toBe('平台')
    expect(describeExtension({ type: 'builtin', name: 'developer' })).toBe('内置')
  })
})

describe('findExtensionName', function () {
  it('display_name 优先，MCP 用扩展名', function () {
    expect(findExtensionName({ type: 'platform', name: 'summarize', display_name: '摘要' })).toBe('摘要')
    expect(findExtensionName({ type: 'platform', name: 'summarize', display_name: '  ' })).toBe('summarize')
    expect(
      findExtensionName({
        type: 'mcp',
        server: { type: 'http', name: 'cogito', url: 'u', headers: [] },
        description: null
      })
    ).toBe('cogito')
  })
})
