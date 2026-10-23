import { findProviderSource, PROVIDER_SOURCE_LABELS } from '@cogito/agent/provider'

/**
 * provider 行的渲染侧类型：形状从 IPC 契约推导，不在这里重抄一份。
 *
 * 谁要用 provider 行都从这里 import —— 之前 `port/model.ts`、`provider/form.tsx`、
 * `model-picker.tsx` 各推导了一遍，加字段就得改三处。
 */

type ProviderRow = Awaited<ReturnType<typeof itc.chat.provider.toRead>>[number]

/** 声明态模型条目（真源：`@cogito/agent/provider` 的 `ModelEntry`） */
type ProviderModel = NonNullable<ProviderRow['models']>[number]

/** 来源文案（组织模型 / 我的模型）：由 kind 派生，不落库，所以不需要迁移 */
function findSourceLabel(provider: ProviderRow): string {
  return PROVIDER_SOURCE_LABELS[findProviderSource(provider.kind)]
}

/** provider 的模型清单：默认模型也算候选，但不重复（UI 与发送链路同口径） */
function collectProviderModels(provider: ProviderRow): ProviderModel[] {
  const models = provider.models ?? []
  if (!provider.model) return models

  const hasDefault = models.some(function (item) {
    return item.id === provider.model
  })
  return hasDefault ? models : [{ id: provider.model }, ...models]
}

/** provider 的默认模型：显式设置 → 清单首项 → 空 */
function findDefaultModel(provider: ProviderRow): string {
  return provider.model || provider.models?.[0]?.id || ''
}

export { collectProviderModels, findDefaultModel, findSourceLabel }
export type { ProviderModel, ProviderRow }
