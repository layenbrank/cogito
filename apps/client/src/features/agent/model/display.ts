/**
 * 模型 / 接入的面向用户展示名（隐藏 goose 内部 id 与英文说明书）。
 */
import { findGatewayModelLabel } from '@/features/agent/model/gateway-labels'
import { GATEWAY_PROVIDER_KIND } from '@/features/quota/gate'

interface ProviderDisplay {
  /** 列表与分组标题 */
  label: string
  /** 一行说明（普通用户可读） */
  hint: string
  /** 模型行副标题里的计费/运行方式 */
  billing: string
}

const PROVIDER_DISPLAY: Record<string, ProviderDisplay> = {
  deepseek: {
    label: 'DeepSeek',
    hint: '填写 API Key 后即可使用 DeepSeek 系列模型',
    billing: '自备密钥 · 按量计费'
  },
  custom_deepseek: {
    label: 'DeepSeek',
    hint: '填写 API Key 后即可使用 DeepSeek 系列模型',
    billing: '自备密钥 · 按量计费'
  },
  openai: {
    label: 'OpenAI',
    hint: '使用 OpenAI 官方 API Key 调用 GPT 等模型',
    billing: '自备密钥 · 按量计费'
  },
  anthropic: {
    label: 'Anthropic',
    hint: '使用 Anthropic API Key 调用 Claude 等模型',
    billing: '自备密钥 · 按量计费'
  },
  google: {
    label: 'Google Gemini',
    hint: '使用 Google AI API Key 调用 Gemini 模型',
    billing: '自备密钥 · 按量计费'
  },
  google_gemini: {
    label: 'Google Gemini',
    hint: '使用 Google AI API Key 调用 Gemini 模型',
    billing: '自备密钥 · 按量计费'
  },
  'gemini-cli': {
    label: 'Gemini CLI',
    hint: '通过本机 Gemini CLI 调用，无需在应用内填写密钥',
    billing: '本机 CLI'
  },
  gemini_cli: {
    label: 'Gemini CLI',
    hint: '通过本机 Gemini CLI 调用，无需在应用内填写密钥',
    billing: '本机 CLI'
  },
  'cursor-agent': {
    label: 'Cursor Agent',
    hint: '通过本机 Cursor Agent 调用已登录账号下的模型',
    billing: '本机 CLI'
  },
  cursor_agent: {
    label: 'Cursor Agent',
    hint: '通过本机 Cursor Agent 调用已登录账号下的模型',
    billing: '本机 CLI'
  },
  alibaba: {
    label: '通义千问',
    hint: '使用阿里云百炼 / DashScope 的 API Key',
    billing: '自备密钥 · 按量计费'
  },
  dashscope: {
    label: '阿里云百炼',
    hint: '使用阿里云百炼 API Key 调用通义等模型',
    billing: '自备密钥 · 按量计费'
  },
  ollama: {
    label: 'Ollama',
    hint: '连接本机 Ollama，使用已下载的本地模型',
    billing: '本机运行'
  },
  openrouter: {
    label: 'OpenRouter',
    hint: '一个密钥访问多家模型，按用量计费',
    billing: '自备密钥 · 按量计费'
  },
  azure_openai: {
    label: 'Azure OpenAI',
    hint: '使用 Azure 上部署的 OpenAI 兼容模型',
    billing: '自备密钥 · 企业订阅'
  },
  azure_foundry: {
    label: 'Azure AI',
    hint: '通过 Azure AI Foundry 调用已部署的模型',
    billing: '自备密钥 · 企业订阅'
  },
  aws_bedrock: {
    label: 'Amazon Bedrock',
    hint: '使用 AWS 账号调用 Bedrock 上的模型',
    billing: 'AWS 账号计费'
  },
  moonshot: {
    label: 'Kimi',
    hint: '使用月之暗面 API Key 调用 Kimi 模型',
    billing: '自备密钥 · 按量计费'
  },
  kimi: {
    label: 'Kimi',
    hint: '使用月之暗面 API Key 调用 Kimi 模型',
    billing: '自备密钥 · 按量计费'
  },
  zhipu: {
    label: '智谱 GLM',
    hint: '使用智谱 API Key 调用 GLM 系列模型',
    billing: '自备密钥 · 按量计费'
  },
  minimax: {
    label: 'MiniMax',
    hint: '使用 MiniMax API Key 调用对应模型',
    billing: '自备密钥 · 按量计费'
  },
  atomic_chat: {
    label: 'Atomic Chat',
    hint: '连接本机 Atomic Chat 提供的本地模型服务',
    billing: '本机运行'
  },
  avian: {
    label: 'Avian',
    hint: '性价比推理接口，支持多家热门模型',
    billing: '自备密钥 · 按量计费'
  },
  celeris: {
    label: 'Celeris',
    hint: '填写 API Key 后即可使用 Celeris 模型',
    billing: '自备密钥 · 按量计费'
  },
  amp: {
    label: 'Amp',
    hint: '通过 Amp 订阅在本机调用对应能力',
    billing: '订阅账号'
  },
  'amp-acp': {
    label: 'Amp',
    hint: '通过 Amp 订阅在本机调用对应能力',
    billing: '订阅账号'
  },
  [GATEWAY_PROVIDER_KIND]: {
    label: '组织模型',
    hint: '由管理员在后台配置的平台模型，登录后即可选用',
    billing: '组织额度'
  }
}

const FIELD_LABELS: Record<string, string> = {
  API_KEY: 'API Key',
  OPENAI_API_KEY: 'API Key',
  ANTHROPIC_API_KEY: 'API Key',
  GOOGLE_API_KEY: 'API Key',
  DASHSCOPE_API_KEY: 'API Key',
  DEEPSEEK_API_KEY: 'API Key',
  MOONSHOT_API_KEY: 'API Key',
  ZHIPU_API_KEY: 'API Key',
  HOST: '服务地址',
  BASE_URL: '服务地址',
  OPENAI_HOST: '服务地址',
  OPENAI_BASE_PATH: '接口路径',
  AZURE_OPENAI_ENDPOINT: '服务地址',
  AZURE_OPENAI_API_KEY: 'API Key',
  AWS_PROFILE: 'AWS Profile',
  AWS_REGION: '区域',
  AWS_ACCESS_KEY_ID: 'Access Key',
  AWS_SECRET_ACCESS_KEY: 'Secret Key',
  MODEL: '默认模型',
  CUSTOM_HEADERS: '自定义请求头'
}

const FALLBACK_HINT = '配置密钥或本机连接后，即可在对话中选用'
const FALLBACK_BILLING = '个人接入'

function findProviderDisplay(providerId: string, providerName?: string | null): ProviderDisplay {
  const raw = providerId.trim()
  const lower = raw.toLowerCase()
  const dashed = lower.replace(/_/g, '-')
  const underscored = lower.replace(/-/g, '_')
  const keyed =
    PROVIDER_DISPLAY[raw] ??
    PROVIDER_DISPLAY[lower] ??
    PROVIDER_DISPLAY[dashed] ??
    PROVIDER_DISPLAY[underscored]
  if (keyed) return keyed

  const name = providerName?.trim()
  if (name && name.toLowerCase() !== lower) {
    return { label: name, hint: FALLBACK_HINT, billing: FALLBACK_BILLING }
  }
  return { label: raw || '未命名接入', hint: FALLBACK_HINT, billing: FALLBACK_BILLING }
}

function findProviderLabel(providerId: string, providerName?: string | null) {
  return findProviderDisplay(providerId, providerName).label
}

function isKnownProvider(providerId: string) {
  const lower = providerId.trim().toLowerCase()
  return Boolean(
    PROVIDER_DISPLAY[providerId] ??
      PROVIDER_DISPLAY[lower] ??
      PROVIDER_DISPLAY[lower.replace(/_/g, '-')] ??
      PROVIDER_DISPLAY[lower.replace(/-/g, '_')]
  )
}

function findProviderHint(providerId: string, providerName?: string | null, rawDescription?: string | null) {
  const display = findProviderDisplay(providerId, providerName)
  if (isKnownProvider(providerId)) return display.hint
  const raw = rawDescription?.trim()
  if (!raw) return display.hint
  // 过长英文说明书不直接塞给用户
  if (raw.length > 72 || /CLI|API|AWS_|BEDROCK|environment|token/i.test(raw)) {
    return display.hint
  }
  return raw
}

function findProviderBilling(providerId: string, providerName?: string | null) {
  return findProviderDisplay(providerId, providerName).billing
}

/** 模型 id → 更易读的展示名（去掉 Bedrock/Azure 修订号与区域前缀） */
function findModelLabel(model: string) {
  const value = model.trim()
  if (!value) return '未选模型'
  if (value === 'auto') return 'Auto（自动）'

  const gatewayLabel = findGatewayModelLabel(value)
  if (gatewayLabel) return gatewayLabel

  // `…-v1:0` / `…:latest` — 不能按 `:` 切段，否则会显示成「0」
  let core = value.replace(/:(?:\d+|latest)$/i, '')

  if (core.includes('/')) {
    const segments = core.split('/').filter(Boolean)
    core = segments[segments.length - 1] ?? core
  }

  // Bedrock：`{region}.{vendor}.{model}`（region 为 us / eu / global / us-east-1 等）
  const bedrock = core.match(
    /^(?:global|[a-z]{2}(?:-[a-z0-9]+)*)\.([a-z0-9-]+)\.(.+)$/i
  )
  if (bedrock) {
    core = bedrock[2]
  } else {
    // `openai.gpt-5.5`、`anthropic.claude-…` → 去掉厂商前缀
    const vendor = core.match(
      /^(openai|anthropic|amazon|meta|cohere|mistral|google|ai21)\.(.+)$/i
    )
    if (vendor) core = vendor[2]
  }

  if (core.length > 42) return `${core.slice(0, 39)}…`
  return core
}

function findFieldLabel(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  const upper = key.toUpperCase()
  if (FIELD_LABELS[upper]) return FIELD_LABELS[upper]
  if (/api[_-]?key/i.test(key) || /secret/i.test(key)) return 'API Key'
  if (/host|endpoint|base[_-]?url/i.test(key)) return '服务地址'
  if (/region/i.test(key)) return '区域'
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, function (char) {
      return char.toUpperCase()
    })
}

export {
  findProviderDisplay,
  findProviderLabel,
  findProviderHint,
  findProviderBilling,
  findModelLabel,
  findFieldLabel
}
