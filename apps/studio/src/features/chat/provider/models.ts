import { PROVIDER_KINDS } from './constants.ts'

/**
 * 模型名候选清单（「默认模型」与「可选用模型」两个下拉的唯一数据源）。
 *
 * 候选来自预设与这一行已声明的名字。预设是**预填清单不是白名单**
 * （见 `@cogito/agent/provider` 的 `ProviderPreset.models`）：清单外的名字一律允许手填，
 * 候选只解决「不用去官网抄模型名」。本地运行时压根没有公开清单，所以候选可以为空。
 */

/** 某家厂商的预设模型名；本地运行时（Ollama / LM Studio / 自定义端点）返回空 */
function findPresetModelIDs(kind: string): readonly string[] {
  const preset = PROVIDER_KINDS.find(function (item) {
    return item.value === kind
  })

  return preset ? preset.models : []
}

/** 是不是任一厂商的预设名（用来分辨某个名字是用户自己敲的还是预设带的） */
function isPresetModelID(id: string): boolean {
  return PROVIDER_KINDS.some(function (preset) {
    return preset.models.includes(id)
  })
}

/** 候选清单 = 预设 → 已声明 → 当前值，去重保序（预设在前，顺序也照预设） */
function collectModelOptions(input: {
  kind: string
  declared: readonly string[]
  current?: string
}): string[] {
  const options = [...findPresetModelIDs(input.kind)]

  function push(id: string): void {
    if (id && !options.includes(id)) options.push(id)
  }

  for (const id of input.declared) push(id)
  push(input.current ?? '')

  return options
}

/** 候选清单按关键字过滤（不区分大小写；空关键字不过滤） */
function filterModelOptions(options: readonly string[], query: string): string[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return [...options]

  return options.filter(function (id) {
    return id.toLowerCase().includes(keyword)
  })
}

/** 勾一个 / 取消一个（保序：新勾的排在后面，与用户的操作顺序一致） */
function toggleModelID(ids: readonly string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter(function (item) {
        return item !== id
      })
    : [...ids, id]
}

/** 追加一批（已选的不重复，用于「全选」） */
function addModelIDs(ids: readonly string[], picked: readonly string[]): string[] {
  const next = [...ids]
  for (const id of picked) {
    if (!next.includes(id)) next.push(id)
  }

  return next
}

export {
  addModelIDs,
  collectModelOptions,
  filterModelOptions,
  findPresetModelIDs,
  isPresetModelID,
  toggleModelID
}
