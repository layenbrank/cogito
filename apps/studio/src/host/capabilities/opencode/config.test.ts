import { describe, expect, it } from 'vitest'

import {
  buildOpencodeConfig,
  buildStudioAgents,
  findDefaultModel,
  findModelIds,
  OPENCODE_PROVIDER_PACKAGE,
  toConfigSignature,
  toOpencodeModel,
  type ProviderRow
} from './config'
import { AGENT_PERMISSION_PROFILES, findPermissionRules, toStudioAgentId } from './permission'
import type { PermissionRule } from './permission'

/**
 * 配置生成里有三处「错了不会报错、只会静默失效」的地方，这里逐条钉住：
 * 1. 平台网关必须带 `X-Tenant-ID`（丢了服务端只会按用户兜底，订阅档位永远不生效）；
 * 2. 模型 id 必须取「目录 ∪ 当前选中」（本机 BYOK 常常只填一个 id，目录是空的）；
 * 3. 三档审批必须落成四个 `studio-*` primary agent（v2 的工具可见性只由 permission 决定）。
 */

const EMPTY_KEYS: ReadonlyMap<string, string> = new Map()

interface ProviderEntry {
  name: string
  package: string
  settings: { baseURL: string; apiKey?: string }
  headers?: Record<string, string>
  models: Record<string, unknown>
}

interface AgentEntry {
  mode: string
  description: string
  permissions: unknown
}

function gatewayRow(partial: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'platform-gateway',
    kind: 'gateway',
    name: '组织模型',
    baseUrl: 'http://127.0.0.1:3000/api/v1/gateway',
    models: null,
    model: 'gpt-4o-mini',
    enabled: true,
    ...partial
  }
}

function openaiRow(partial: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'byok-openai',
    kind: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: null,
    model: 'gpt-4o-mini',
    enabled: true,
    ...partial
  }
}

function findProviders(config: Record<string, unknown>): Record<string, ProviderEntry> {
  return (config.providers ?? {}) as Record<string, ProviderEntry>
}

function findEntry(config: Record<string, unknown>, id: string): ProviderEntry {
  const entry = findProviders(config)[id]
  expect(entry, `provider ${id}`).toBeDefined()
  return entry
}

describe('buildOpencodeConfig · 租户请求头', function () {
  it('平台网关带上 X-Tenant-ID，凭据用登录令牌', function () {
    const { config } = buildOpencodeConfig({
      providers: [gatewayRow()],
      credentials: { apiKeys: EMPTY_KEYS, platformToken: 'jwt', tenantID: 't-1' }
    })

    const entry = findEntry(config, 'platform-gateway')
    expect(entry.settings).toEqual({
      baseURL: 'http://127.0.0.1:3000/api/v1/gateway',
      apiKey: 'jwt'
    })
    expect(entry.headers).toEqual({ 'X-Tenant-ID': 't-1' })
  })

  it('没有租户时不写 headers 键（免得给 provider 塞一个空对象）', function () {
    const { config } = buildOpencodeConfig({
      providers: [gatewayRow()],
      credentials: { apiKeys: EMPTY_KEYS, platformToken: 'jwt', tenantID: null }
    })

    expect(findEntry(config, 'platform-gateway').headers).toBeUndefined()
  })

  it('本机 BYOK 不带租户头，凭据用钥匙串里的 apiKey', function () {
    const { config } = buildOpencodeConfig({
      providers: [openaiRow()],
      credentials: {
        apiKeys: new Map([['byok-openai', 'sk-1']]),
        platformToken: 'jwt',
        tenantID: 't-1'
      }
    })

    const entry = findEntry(config, 'byok-openai')
    expect(entry.settings).toEqual({ baseURL: 'https://api.openai.com/v1', apiKey: 'sk-1' })
    expect(entry.headers).toBeUndefined()
  })

  it('本机无凭据的端点（Ollama / LM Studio）只给 baseURL', function () {
    const { config, defaultModel } = buildOpencodeConfig({
      providers: [openaiRow({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' })],
      credentials: { apiKeys: EMPTY_KEYS, platformToken: null }
    })

    expect(findEntry(config, 'byok-openai').settings).toEqual({
      baseURL: 'http://127.0.0.1:11434/v1'
    })
    expect(defaultModel).toBe('byok-openai/gpt-4o-mini')
  })

  it('所有 provider 都映射成同一个 openai-compatible 包', function () {
    const { config } = buildOpencodeConfig({
      providers: [gatewayRow(), openaiRow()],
      credentials: {
        apiKeys: new Map([['byok-openai', 'sk-1']]),
        platformToken: 'jwt',
        tenantID: 't-1'
      }
    })

    expect(findEntry(config, 'platform-gateway').package).toBe(OPENCODE_PROVIDER_PACKAGE)
    expect(findEntry(config, 'byok-openai').package).toBe(OPENCODE_PROVIDER_PACKAGE)
  })

  it('换租户会改变配置指纹（server 需按新租户重启）', function () {
    const build = function (tenantID: string) {
      return buildOpencodeConfig({
        providers: [gatewayRow()],
        credentials: { apiKeys: EMPTY_KEYS, platformToken: 'jwt', tenantID }
      }).config
    }

    expect(toConfigSignature(build('t-1'))).not.toBe(toConfigSignature(build('t-2')))
    expect(toConfigSignature(build('t-1'))).toBe(toConfigSignature(build('t-1')))
  })
})

describe('buildOpencodeConfig · provider 装配', function () {
  it('未登录时不产出注定失败的网关 provider', function () {
    const { config, defaultModel } = buildOpencodeConfig({
      providers: [gatewayRow()],
      credentials: { apiKeys: EMPTY_KEYS, platformToken: null, tenantID: 't-1' }
    })

    expect(config.providers).toBeUndefined()
    expect(defaultModel).toBeNull()
  })

  it('关掉的 provider 与没有任何模型可选的行都不进配置', function () {
    const { config, defaultModel } = buildOpencodeConfig({
      providers: [openaiRow({ enabled: false }), openaiRow({ id: 'empty', model: null })],
      credentials: { apiKeys: EMPTY_KEYS, platformToken: null }
    })

    expect(config.providers).toBeUndefined()
    expect(defaultModel).toBeNull()
  })

  it('缺 baseUrl 的行跳过（opencode 里不该有一个注定 404 的 provider）', function () {
    const { config } = buildOpencodeConfig({
      providers: [openaiRow({ baseUrl: null }), gatewayRow()],
      credentials: {
        apiKeys: new Map([['byok-openai', 'sk-1']]),
        platformToken: 'jwt',
        tenantID: 't-1'
      }
    })

    expect(Object.keys(findProviders(config))).toEqual(['platform-gateway'])
  })

  it('云端 provider 没配 Key 就不进配置（否则 opencode 里会出现一个注定失败的 provider）', function () {
    const { config, defaultModel } = buildOpencodeConfig({
      providers: [openaiRow(), gatewayRow()],
      credentials: { apiKeys: EMPTY_KEYS, platformToken: null }
    })

    expect(config.providers).toBeUndefined()
    expect(defaultModel).toBeNull()
  })

  it('模型 id 取目录与当前选中模型的并集', function () {
    const { config } = buildOpencodeConfig({
      providers: [
        openaiRow({
          model: 'gpt-4o-mini',
          models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
        })
      ],
      credentials: { apiKeys: new Map([['byok-openai', 'sk-1']]), platformToken: null }
    })

    expect(Object.keys(findEntry(config, 'byok-openai').models)).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('目录里声明过的模型给出完整能力，手填的只占一个 id', function () {
    const { config } = buildOpencodeConfig({
      providers: [
        openaiRow({
          model: 'hand-written',
          models: [
            {
              id: 'gpt-4o',
              name: 'GPT-4o',
              capabilities: { tools: true, vision: true },
              limit: { context: 200_000, output: 16_384 }
            }
          ]
        })
      ],
      credentials: { apiKeys: new Map([['byok-openai', 'sk-1']]), platformToken: null }
    })

    const models = findEntry(config, 'byok-openai').models
    expect(models['gpt-4o']).toEqual({
      name: 'GPT-4o',
      capabilities: { tools: true, input: ['text', 'image'], output: ['text'] },
      limit: { context: 200_000, output: 16_384 }
    })
    expect(models['hand-written']).toEqual({})
  })

  it('默认模型优先选平台网关的当前模型', function () {
    const { defaultModel } = buildOpencodeConfig({
      providers: [openaiRow(), gatewayRow({ model: 'gpt-4o-mini' })],
      credentials: {
        apiKeys: new Map([['byok-openai', 'sk-1']]),
        platformToken: 'jwt',
        tenantID: 't-1'
      }
    })

    expect(defaultModel).toBe('platform-gateway/gpt-4o-mini')
  })

  it('没有平台网关时回退到第一个可用 provider 的当前模型', function () {
    expect(findDefaultModel([openaiRow({ model: null, models: [{ id: 'llama3' }] })])).toBe(
      'byok-openai/llama3'
    )
    expect(findDefaultModel([])).toBeNull()
  })

  it('findModelIds 去重且丢弃空 id', function () {
    expect(
      findModelIds(
        openaiRow({
          model: 'gpt-4o',
          models: [{ id: 'gpt-4o' }, { id: '' }, { id: 'gpt-4o-mini' }]
        })
      )
    ).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })
})

describe('toOpencodeModel · 能力字段翻译', function () {
  it('图片能力翻成 input 介质数组（v2 没有 attachment 布尔值）', function () {
    const textOnly = toOpencodeModel({ id: 'a', capabilities: { vision: false } })
    const vision = toOpencodeModel({ id: 'b', capabilities: { vision: true } })

    expect((textOnly.capabilities as { input: string[] }).input).toEqual(['text'])
    expect((vision.capabilities as { input: string[] }).input).toEqual(['text', 'image'])
  })

  it('未声明能力时按「能用」兜底（与 provider.ts 的默认一致）', function () {
    const model = toOpencodeModel({ id: 'a' })

    expect(model.capabilities).toMatchObject({ tools: true, output: ['text'] })
    expect(model.limit).toMatchObject({ context: 128_000, output: 8_192 })
  })

  it('显式声明不支持工具时如实下发（引擎据此切纯聊天档）', function () {
    const model = toOpencodeModel({ id: 'a', capabilities: { tools: false } })

    expect(model.capabilities).toMatchObject({ tools: false })
  })
})

describe('buildStudioAgents · 档位落成自定义 primary agent', function () {
  it('四个档位各一个 primary agent，permission 与 permission.ts 同源', function () {
    const agents = buildStudioAgents([]) as Record<string, AgentEntry>

    expect(Object.keys(agents).sort()).toEqual(
      AGENT_PERMISSION_PROFILES.map(toStudioAgentId).sort()
    )
    for (const profile of AGENT_PERMISSION_PROFILES) {
      const agent = agents[toStudioAgentId(profile)]
      expect(agent.mode).toBe('primary')
      expect(agent.description.length).toBeGreaterThan(0)
      expect(agent.permissions).toEqual(findPermissionRules(profile, []))
    }
  })

  it('工作区的其它根授权给 external_directory（排在越界守卫之后才生效）', function () {
    const folders = ['D:\\Documents\\Rust\\service\\master', 'D:/Documents/monorepo/cogito/master/']
    const agents = buildStudioAgents(folders) as Record<string, AgentEntry>

    for (const profile of ['auto', 'ask', 'readonly'] as const) {
      const rules = agents[toStudioAgentId(profile)].permissions as PermissionRule[]
      const guard = rules.findIndex(function (rule) {
        return rule.action === 'external_directory' && rule.resource === '*'
      })
      const grants = rules.filter(function (rule) {
        return rule.action === 'external_directory' && rule.resource !== '*'
      })

      // 规范化：反斜杠转正斜杠、去掉尾部的 `/`，两种边界都授权
      expect(
        grants.map(function (rule) {
          return rule.resource
        })
      ).toEqual([
        'D:/Documents/Rust/service/master',
        'D:/Documents/Rust/service/master/*',
        'D:/Documents/monorepo/cogito/master',
        'D:/Documents/monorepo/cogito/master/*'
      ])
      expect(
        grants.every(function (rule) {
          return rule.effect === 'allow'
        })
      ).toBe(true)
      // last match wins：授权必须排在守卫后面，否则等于没加
      expect(rules.indexOf(grants[0])).toBeGreaterThan(guard)
    }
  })

  it('纯聊天档不给 external_directory 授权（一个工具都不给）', function () {
    const agents = buildStudioAgents(['D:\\Documents\\Rust\\service\\master']) as Record<
      string,
      AgentEntry
    >

    expect(agents[toStudioAgentId('chat')].permissions).toEqual(findPermissionRules('chat'))
  })

  it('agent 不写 system（写了就整体替换掉 opencode 内建的编码提示词）', function () {
    for (const agent of Object.values(buildStudioAgents([]) as Record<string, AgentEntry>)) {
      expect(agent).not.toHaveProperty('system')
    }
  })
})

describe('buildOpencodeConfig · 顶层形状', function () {
  it('不设顶层 model（每次运行都由 engine 显式带 provider/model）', function () {
    const { config } = buildOpencodeConfig({
      providers: [gatewayRow()],
      credentials: { apiKeys: EMPTY_KEYS, platformToken: 'jwt', tenantID: 't-1' }
    })

    expect(config).not.toHaveProperty('model')
    expect(config.$schema).toBe('https://opencode.ai/config.json')
  })

  it('没有任何可用 provider 时仍然产出 agents（否则 server 起不来）', function () {
    const { config } = buildOpencodeConfig({
      providers: [],
      credentials: { apiKeys: EMPTY_KEYS, platformToken: null }
    })

    expect(Object.keys(config.agents as Record<string, unknown>)).toHaveLength(
      AGENT_PERMISSION_PROFILES.length
    )
  })
})
