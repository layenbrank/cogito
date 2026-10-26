/**
 * corex 能力地图：把动作目录压成可注入 system prompt 的紧凑文本。
 *
 * 约束：
 * - 目录是**动态**的（随 corex 版本变化），所以只给「id + 名称 + 必填参数 + 权限/风险」；
 *   参数细节让模型调 `corex_actions` / `corex_action`，不要预注入整份 JSON Schema。
 * - 有 token 预算：按 bucket 轮转截断，超出的部分明确写「调用 corex_actions 查看」。
 * - 模型最容易犯的错是臆造动作 id，所以标题里必须有「禁止臆造」。
 */
import type { ActionEntry } from '@/lib/directive-ipc'

const BUCKET_ORDER = ['system', 'ui', 'data', 'network', 'logic', 'plugin'] as const

const BUCKET_LABELS: Readonly<Record<string, string>> = {
  system: '系统',
  ui: '界面',
  data: '数据',
  network: '网络',
  logic: '逻辑',
  plugin: '插件'
}

interface CapabilityOptions {
  /** 总预算（字符）。默认 6000，约 2k token 量级 */
  maxChars?: number
  /** 每个 bucket 最多列多少条 */
  maxPerBucket?: number
}

interface CapabilitySummary {
  text: string
  total: number
  shown: number
}

function formatRisk(risk: unknown): string {
  if (typeof risk === 'string' && risk.trim()) return ` · 风险 ${risk.trim()}`
  if (typeof risk === 'number') return ` · 风险 ${risk}`
  // corex 实际返回的是对象：{ is_read_only, is_destructive, is_open_world }
  if (risk && typeof risk === 'object') {
    const flags = risk as Record<string, unknown>
    const labels: string[] = []
    if (flags.is_read_only === true) labels.push('只读')
    if (flags.is_destructive === true) labels.push('破坏性')
    if (flags.is_open_world === true) labels.push('开放世界')
    return labels.length ? ` · 风险 ${labels.join('/')}` : ''
  }
  return ''
}

function formatAction(action: ActionEntry): string {
  const required = (action.params ?? [])
    .filter(function (param) {
      return param.required
    })
    .map(function (param) {
      return param.name
    })
  const permissions = action.permissions?.length ? ` · 权限 ${action.permissions.join('/')}` : ''
  return `- ${action.id} ${action.name}${
    required.length ? `（必填：${required.join(', ')}）` : ''
  }${permissions}${formatRisk(action.risk)}`
}

function sortBuckets(buckets: string[]): string[] {
  return buckets.toSorted(function (a, b) {
    const left = BUCKET_ORDER.indexOf(a as (typeof BUCKET_ORDER)[number])
    const right = BUCKET_ORDER.indexOf(b as (typeof BUCKET_ORDER)[number])
    if (left === -1 && right === -1) return a.localeCompare(b)
    if (left === -1) return 1
    if (right === -1) return -1
    return left - right
  })
}

function buildCapabilitySummary(
  actions: readonly ActionEntry[],
  options: CapabilityOptions = {}
): CapabilitySummary {
  if (actions.length === 0) return { text: '', total: 0, shown: 0 }

  const maxChars = options.maxChars ?? 6000
  const maxPerBucket = options.maxPerBucket ?? 40
  const grouped = new Map<string, ActionEntry[]>()
  for (const action of actions) {
    const bucket = action.bucket || 'data'
    const list = grouped.get(bucket) ?? []
    list.push(action)
    grouped.set(bucket, list)
  }

  const lines: string[] = [
    `## corex 动作目录（共 ${actions.length} 个；**只能使用下面真实存在的动作 id，禁止臆造**）`,
    '需要参数细节时调用 corex_actions（可分 bucket）或 corex_action；需要校验/试跑时调用 corex_validate / corex_invoke。'
  ]

  let shown = 0
  let truncated = false
  const buckets = sortBuckets([...grouped.keys()])
  for (const bucket of buckets) {
    const list = grouped.get(bucket) ?? []
    const title = BUCKET_LABELS[bucket] ?? bucket
    const block: string[] = [`### ${bucket}（${title}，${list.length} 个）`]
    const limited = list.slice(0, maxPerBucket)
    for (const action of limited) {
      const line = formatAction(action)
      if (lines.join('\n').length + block.join('\n').length + line.length > maxChars) {
        truncated = true
        break
      }
      block.push(line)
      shown += 1
    }
    if (limited.length < list.length) {
      block.push(`- …另有 ${list.length - limited.length} 个，调用 corex_actions bucket=${bucket} 查看`)
    }
    lines.push(...block)
    if (truncated) break
  }

  if (truncated) {
    lines.push('（能力地图已按预算截断；完整目录请调用 corex_actions）')
  }
  return { text: lines.join('\n'), total: actions.length, shown }
}

export { BUCKET_LABELS, BUCKET_ORDER, buildCapabilitySummary, formatAction }
export type { CapabilityOptions, CapabilitySummary }
