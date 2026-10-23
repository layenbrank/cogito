import type { ModelEntry } from '@cogito/agent/provider'
import { z } from 'zod'

/**
 * provider 表单校验。
 *
 * `apiKey` 不落 provider 行（进主进程 safeStorage），所以它只在表单里出现，
 * 提交时由调用方单独写给 `itc.assistant.key.toWrite`。
 */

const PROVIDER_SCHEMA = z.object({
  kind: z.string().min(1),
  name: z.string().min(1, '请填写名称').max(60, '名称过长'),
  baseUrl: z.union([z.url('请填写正确的地址'), z.literal('')]),
  model: z.string().min(1, '请填写模型').max(120),
  /** 可选用模型清单（只有模型名）；留空表示只提供默认模型 */
  models: z.array(z.string().min(1).max(120)).max(64),
  apiKey: z.string().max(4096),
  enabled: z.boolean()
})

type ProviderValues = z.infer<typeof PROVIDER_SCHEMA>

/**
 * 模型名清单 → 模型条目数组（空 → null，与 IPC 约定一致）。
 *
 * `existing` 是这一行原有的条目：表单只编辑模型名，能力/上限声明得原样带回去，
 * 否则「更新 API Key」这种提交会把已声明过的能力抹掉。
 */
function toModelEntries(
  ids: readonly string[],
  existing: ModelEntry[] | null
): ModelEntry[] | null {
  const unique = ids
    .map(function (id) {
      return id.trim()
    })
    .filter(Boolean)

  if (unique.length === 0) return null

  return unique.map(function (id) {
    const kept = existing?.find(function (item) {
      return item.id === id
    })
    return kept ?? { id }
  })
}

/** 落库的模型条目 → 表单值（表单只关心模型名） */
function toModelIDs(models: ModelEntry[] | null): string[] {
  return models
    ? models.map(function (item) {
        return item.id
      })
    : []
}

export { PROVIDER_SCHEMA, toModelEntries, toModelIDs }
export type { ProviderValues }
