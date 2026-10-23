import {
  GATEWAY_PROVIDER_KIND,
  PROVIDER_KIND_LABELS,
  PROVIDER_PRESETS
} from '@cogito/agent/provider'

/**
 * provider 表单常量（原始数据）。
 *
 * 类型列表直接取 `@cogito/agent/provider` 的预设表（唯一真源）：加一家厂商只改契约包，
 * 表单、展示名、默认地址、预填模型自动跟上。平台网关那条不是用户手建的，从选项里排除。
 *
 * 所有类型都是 OpenAI 兼容端点，区别只是默认地址与命名（便于用户认）；
 * 真正发请求的是内嵌 opencode（它用 `@ai-sdk/openai-compatible` provider 打上游）。
 * 地址必须是 **OpenAI 兼容根路径**（含 `/v1`）：provider 自己接 `/chat/completions`。
 *
 * 预设怎么落到表单字段（预填什么、什么时候不覆盖用户输入）见 `preset.ts`。
 */

const PROVIDER_KINDS = PROVIDER_PRESETS.filter(function (preset) {
  return preset.kind !== GATEWAY_PROVIDER_KIND
}).map(function (preset) {
  return {
    value: preset.kind,
    label: preset.name,
    baseUrl: preset.baseUrl,
    models: preset.models
  }
})

/** 表单默认选本机（不需要 Key，开箱可用）；云端预设仍在列表里 */
const DEFAULT_KIND = 'ollama'

type ProviderKindOption = (typeof PROVIDER_KINDS)[number]

export { DEFAULT_KIND, PROVIDER_KINDS, PROVIDER_KIND_LABELS }
export type { ProviderKindOption }
