import { toModel, type ModelEntry } from '@cogito/agent/provider'

import { isGatewayProvider, resolveConnection } from '@/host/capabilities/assistant/model'
import {
  AGENT_PERMISSION_PROFILES,
  findPermissionRules,
  findProfileDescription,
  toStudioAgentId
} from './permission'

/**
 * 由 studio 的 provider 行生成 opencode v2 的内联配置（`OPENCODE_CONFIG_CONTENT`）。
 *
 * 两个刻意的选择：
 * 1. **内联注入，不落盘**：配置里带着 apiKey（BYOK 明文 + 平台登录令牌），落盘等于把凭据
 *    复制一份到磁盘；opencode 支持从环境变量读整份配置，用完随进程消失。
 * 2. **写全所有可用 provider**：只写「当前选中那个」的话，用户每换一次模型配置就变、
 *    就要重启 server（实测配置不热重载）。写全之后换模型不动配置，代价是几个 key 同时
 *    存在于我们自己的子进程内存里 —— 与主进程同信任域，可接受。
 *
 * 每个 studio provider 都映射成 `@opencode/ai/providers/openai-compatible`：studio 的全部
 * provider preset（openai / deepseek / qwen / zhipu / ollama / lm-studio / openai-compatible）
 * 本来就是 OpenAI 兼容端点，唯一例外的 Anthropic 在 preset 里已标成不支持。
 *
 * **三档审批不在这里拍板**，而是编译成四个自定义 primary agent（见 permission.ts）：v2 的工具
 * 可见性只由 permission 决定，规则改一次要重启 server，做成 agent 之后每次运行切 agent 即可。
 * agent 不写 `system` —— 实测会逐字继承 opencode 内置编码 agent 的提示词，写一个 studio 自己的
 * 提示词只会让工具用法、审批语义这些「内建知识」跟着漂移。
 */

/** studio 侧 provider 行里，生成配置需要的字段 */
interface ProviderRow {
  id: string
  kind: string
  name: string
  baseUrl: string | null
  models: ModelEntry[] | null
  model: string | null
  enabled: boolean
}

interface ProviderCredentials {
  /** providerID → 明文 apiKey（BYOK，由主进程密钥库解出） */
  apiKeys: ReadonlyMap<string, string>
  /** 平台网关的登录令牌（渲染进程随请求带来） */
  platformToken: string | null
  /** 平台网关的租户 id：网关按它算配额（订阅档位只对个人租户生效） */
  tenantID?: string | null
}

interface OpencodeConfigInput {
  providers: readonly ProviderRow[]
  credentials: ProviderCredentials
  /** 工作区的全部根目录：授权给 `external_directory`，见 `buildStudioAgents` */
  folders?: readonly string[]
}

interface OpencodeConfigResult {
  config: Record<string, unknown>
  /** `providerID/modelID`，本次选中的模型；没有可用 provider 时为 null */
  defaultModel: string | null
}

const OPENCODE_PROVIDER_PACKAGE = '@opencode/ai/providers/openai-compatible'

/**
 * opencode v2 的模型能力声明：与 studio 的 `capabilities` 字段名不同，逐一翻译。
 *
 * v2 用 `input` / `output` 两个介质数组代替 v1 的 `attachment` 布尔值（`image` 就是视觉能力），
 * 且**没有** `reasoning` 声明 —— 推理内容由 provider 的流字段（`reasoning` / `reasoning_content`）
 * 自动识别，所以 studio 的 `capabilities.reasoning` 在这里不落地。
 */
function toOpencodeModel(model: ModelEntry): Record<string, unknown> {
  const full = toModel(model)
  return {
    name: full.name,
    capabilities: {
      tools: full.capabilities.tools,
      input: full.capabilities.vision ? ['text', 'image'] : ['text'],
      output: ['text']
    },
    limit: { context: full.limit.context, output: full.limit.output }
  }
}

/**
 * 该 provider 在 opencode 里能选的模型 id 集合。
 *
 * 取「目录里的模型」∪「当前选中的模型」：本机 BYOK 常常是用户手填一个 id（目录为空），
 * 只认目录会让选中的模型在 opencode 里不存在，请求直接 400。
 */
function findModelIds(provider: ProviderRow): string[] {
  const ids = new Set<string>()
  for (const model of provider.models ?? []) {
    if (model.id) ids.add(model.id)
  }
  if (provider.model) ids.add(provider.model)
  return [...ids]
}

function toProviderEntry(
  provider: ProviderRow,
  connection: { baseURL: string; apiKey?: string; headers?: Record<string, string> }
): Record<string, unknown> {
  const models: Record<string, unknown> = {}
  for (const id of findModelIds(provider)) {
    const declared = (provider.models ?? []).find(function (model) {
      return model.id === id
    })
    models[id] = declared ? toOpencodeModel(declared) : {}
  }

  return {
    name: provider.name,
    package: OPENCODE_PROVIDER_PACKAGE,
    settings: {
      baseURL: connection.baseURL,
      ...(connection.apiKey ? { apiKey: connection.apiKey } : {})
    },
    // 附加请求头放 provider 级 `headers`（`Config.ProviderEncoded` 的字段，实测生效）：
    // 平台网关靠 `X-Tenant-ID` 认租户，丢了它就变成「有令牌但算不到配额上」
    ...(connection.headers ? { headers: connection.headers } : {}),
    models
  }
}

/** 默认模型：优先平台网关当前选中的那个（studio 模型选择器的默认值同源） */
function findDefaultModel(usable: readonly ProviderRow[]): string | null {
  const platform = usable.find(isGatewayProvider)
  const preferred = platform ?? usable[0]
  if (!preferred) return null

  const modelID = preferred.model ?? findModelIds(preferred)[0]
  return modelID ? `${preferred.id}/${modelID}` : null
}

/**
 * 四个自定义 primary agent：三个档位 + 「当前模型不支持工具」的纯聊天档。
 * 每次运行由 engine 切 agent，所以档位切换不需要重启 server。
 *
 * `folders`：工作区里除当前工作目录之外的根，授权给 `external_directory`（见 permission.ts）。
 * 配置是**整个 server 一份**，所以传的是「全部未归档工作区的根」的并集 —— 只传当前工作区的
 * 话，用户每切一次工作区配置指纹就变、就要白重启一次 server。
 */
function buildStudioAgents(folders: readonly string[]): Record<string, unknown> {
  const agents: Record<string, unknown> = {}
  for (const profile of AGENT_PERMISSION_PROFILES) {
    agents[toStudioAgentId(profile)] = {
      mode: 'primary',
      description: findProfileDescription(profile),
      permissions: findPermissionRules(profile, folders)
    }
  }
  return agents
}

/**
 * 生成整份 opencode 配置。
 *
 * **不设顶层 `model`**：它只决定 opencode 自己的默认模型，而 studio 每次建会话都显式带
 * `provider/model`（见 engine.ts）；写进来反而会让「换模型」改动配置指纹、白重启一次 server。
 */
function buildOpencodeConfig(input: OpencodeConfigInput): OpencodeConfigResult {
  const providers: Record<string, unknown> = {}
  const usable: ProviderRow[] = []

  for (const row of input.providers) {
    if (!row.enabled) continue
    if (findModelIds(row).length === 0) continue

    const connection = resolveConnection(row, {
      apiKey: input.credentials.apiKeys.get(row.id) ?? null,
      platformToken: input.credentials.platformToken,
      tenantID: input.credentials.tenantID ?? null
    })
    // 解析不了（缺 baseUrl / 未登录）就跳过：opencode 里不该出现一个注定失败的 provider
    if (typeof connection === 'string') continue

    usable.push(row)
    providers[row.id] = toProviderEntry(row, connection)
  }

  return {
    config: {
      $schema: 'https://opencode.ai/config.json',
      ...(usable.length > 0 ? { providers } : {}),
      agents: buildStudioAgents(input.folders ?? [])
    },
    defaultModel: findDefaultModel(usable)
  }
}

/** 配置指纹：只有它变了才需要重启 server */
function toConfigSignature(config: Record<string, unknown>): string {
  return JSON.stringify(config)
}

export {
  buildOpencodeConfig,
  buildStudioAgents,
  findDefaultModel,
  findModelIds,
  toConfigSignature,
  toOpencodeModel,
  OPENCODE_PROVIDER_PACKAGE
}
export type { OpencodeConfigInput, OpencodeConfigResult, ProviderCredentials, ProviderRow }
