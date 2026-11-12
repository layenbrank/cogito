/**
 * 「这个模型到底能不能思考、能调到哪几档」的缓存。
 *
 * 判定来源只有一个可信的：**goose 会话真的给出了选项**（ACP `configOptions` 里的
 * thinking 选择项）。名字启发式（`canThink`）只在还没建过会话时兜底 ——
 * `deepseek-chat` 这种名字看起来能思考、实际收不到参数的模型以前就是被名字骗了。
 *
 * 这里同时记「实际下发值」：用户点的是「标准」，模型只认 high，UI 必须把
 * 「实际下发 high」说出来，否则点了没差别又变成「界面骗人」。
 *
 * 纯内存：会话重建会重写；刷新后回到「还不知道」，此时落到名字兜底。
 */
import { useSyncExternalStore } from 'react'

interface ThinkingCapability {
  /** 会话真实给出的可选值（小写） */
  values: readonly string[]
  /** 上一次真正写进去的取值；还没写过是 null */
  applied: string | null
  /**
   * 这个 applied 写到哪一级：
   * - `session`：当前会话的 config option，本轮生效；
   * - `global`：goose 全局键（新会话生效）—— 会话没给 thinking 选项时只能走这条，
   *   文案必须如实说清楚，否则又是「界面说已生效、实际没变」。
   */
  scope: 'session' | 'global'
}

const cache = new Map<string, ThinkingCapability>()
const listeners = new Set<() => void>()

function subscribeThinkingCapability(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function emit() {
  listeners.forEach(function (listener) {
    try {
      listener()
    } catch (error) {
      console.warn('[thinking-capability] 订阅回调抛错:', error)
    }
  })
}

/** 会话给出的选项变了才写；老的 `applied` 保住，避免每次建会话都把回执清空 */
function recordThinkingCapability(key: string, values: readonly string[]): void {
  const normalized = values.map(function (value) {
    return value.trim().toLowerCase()
  })
  const previous = cache.get(key)
  if (
    previous &&
    previous.values.length === normalized.length &&
    previous.values.every(function (value, index) {
      return value === normalized[index]
    })
  ) {
    return
  }
  cache.set(key, {
    values: normalized,
    applied: previous?.applied ?? null,
    scope: previous?.scope ?? 'global'
  })
  emit()
}

/** 记下真正下发成功的取值（session 层调） */
function recordThinkingApplied(
  key: string,
  applied: string,
  scope: 'session' | 'global' = 'session'
): void {
  const previous = cache.get(key)
  const next = {
    values: previous?.values ?? [],
    applied: applied.trim().toLowerCase(),
    scope
  }
  if (previous && previous.applied === next.applied && previous.scope === next.scope) return
  cache.set(key, next)
  emit()
}

function findThinkingCapability(key: string): ThinkingCapability | null {
  return cache.get(key) ?? null
}

function clearThinkingCapability(key?: string): void {
  if (key) cache.delete(key)
  else cache.clear()
  emit()
}

/** 组件订阅：拿到的是同一个对象引用，直到这个模型的选项/回执真的变了 */
function useThinkingCapability(key: string): ThinkingCapability | null {
  return useSyncExternalStore(
    subscribeThinkingCapability,
    function () {
      return findThinkingCapability(key)
    },
    function () {
      return findThinkingCapability(key)
    }
  )
}

export {
  clearThinkingCapability,
  findThinkingCapability,
  recordThinkingApplied,
  recordThinkingCapability,
  subscribeThinkingCapability,
  useThinkingCapability
}
export type { ThinkingCapability }
