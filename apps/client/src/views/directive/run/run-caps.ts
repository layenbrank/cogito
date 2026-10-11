/**
 * 运行能力：指令是否声明 cron / watch 触发器。
 */

import { fetchDirective } from '@/lib/directive-ipc.ts'

interface Caps {
  hasCron: boolean
  hasWatch: boolean
}

interface SummaryLike {
  has_cron?: boolean
  has_watch?: boolean
  trigger_count?: number
}

const CAPS_CACHE_MS = 10_000
const CAPS_CACHE = new Map<string, { at: number; caps: Caps }>()

function triggerKind(trigger: { type?: string }): string {
  return typeof trigger.type === 'string' ? trigger.type.trim().toLowerCase() : ''
}

function capsFromTriggers(triggers: Array<{ type?: string }> | undefined): Caps {
  const items = triggers ?? []
  return {
    hasCron: items.some(function (trigger) {
      return triggerKind(trigger) === 'cron'
    }),
    hasWatch: items.some(function (trigger) {
      return triggerKind(trigger) === 'watch'
    })
  }
}

function capsFromSummary(summary: SummaryLike | null | undefined): Caps {
  if (!summary) return { hasCron: false, hasWatch: false }
  const hasCron = summary.has_cron === true
  const hasWatch = summary.has_watch === true
  if (!hasCron && !hasWatch && (summary.trigger_count ?? 0) > 0) {
    return { hasCron: true, hasWatch: true }
  }
  return { hasCron, hasWatch }
}

async function findDirectiveCaps(name: string): Promise<Caps> {
  const now = Date.now()
  const hit = CAPS_CACHE.get(name)
  if (hit && now - hit.at < CAPS_CACHE_MS) return hit.caps
  try {
    const document = await fetchDirective(name)
    const caps = capsFromTriggers(document.definition.triggers)
    CAPS_CACHE.set(name, { at: now, caps })
    return caps
  } catch (error) {
    console.warn('[run-caps] 读取指令定义失败', name, error)
    return hit?.caps ?? { hasCron: true, hasWatch: true }
  }
}

export { capsFromSummary, capsFromTriggers, findDirectiveCaps }
export type { Caps, SummaryLike }
