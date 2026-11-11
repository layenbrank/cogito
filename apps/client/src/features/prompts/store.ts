/**
 * 提示词库的本地存储。
 *
 * 为什么单独一个 Tauri Store 文件，而不是塞进 `features/persist` 的 agent 偏好：
 * - 它不是「偏好」而是用户内容，可能几十条、每条几百字，放进 persist 会让
 *   `parseNamespace` 的整树校验跟着变重；
 * - 生命周期也不同：偏好可以重置成默认，提示词删了就是删了（删光之后不再播种）。
 *
 * 非 Tauri 运行时（vitest / 浏览器预览）只走内存，不碰磁盘 —— 与 persist 的约定一致。
 */
import { LazyStore } from '@tauri-apps/plugin-store'
import { useEffect, useSyncExternalStore } from 'react'

import { DEFAULT_PROMPTS } from './defaults'
import type { SavedPrompt } from './types'

const STORE_FILE = 'prompts.json'
const STORE_KEY = 'value'
/** 上限：再多就不适合用 `::` 面板翻了，应该拆成工作区资产 */
const MAX_PROMPTS = 200
const TITLE_LIMIT = 80

let cache: SavedPrompt[] = []
let snapshot: readonly SavedPrompt[] = []
let isHydrated = false
let hydratePromise: Promise<void> | null = null
let store: LazyStore | null = null
const listeners = new Set<() => void>()

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

function rebuildSnapshot(): void {
  snapshot = cache.slice().sort(function (left, right) {
    // 刚改过的排前面；种子（updatedAt=0）自然沉底
    return right.updatedAt - left.updatedAt
  })
}

function emit(): void {
  rebuildSnapshot()
  for (const listener of listeners) listener()
}

function newID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toTime(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 反序列化：任何一条坏数据都不该把整个库读空。
 * 缺 id / 正文为空的行直接丢弃；id 重复时保留先出现的那条。
 */
function normalizePrompts(raw: unknown): SavedPrompt[] {
  if (!Array.isArray(raw)) return []
  const rows: SavedPrompt[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as Partial<SavedPrompt>
    const id = toText(row.id)
    const body = toText(row.body)
    if (!id || !body || seen.has(id)) continue
    seen.add(id)
    const createdAt = toTime(row.createdAt, 0)
    rows.push({
      id,
      title: toText(row.title) || deriveTitle(body),
      body,
      createdAt,
      updatedAt: toTime(row.updatedAt, createdAt)
    })
    if (rows.length >= MAX_PROMPTS) break
  }
  return rows
}

/** 标题缺省时取正文首行（截到 40 字），避免列表里出现一整段模板 */
function deriveTitle(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const limited = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine
  return limited || '未命名提示词'
}

function findStore(): LazyStore {
  store ??= new LazyStore(STORE_FILE, {
    defaults: { [STORE_KEY]: DEFAULT_PROMPTS },
    autoSave: 250
  })
  return store
}

async function ensurePrompts(): Promise<void> {
  if (isHydrated) return
  if (hydratePromise) {
    await hydratePromise
    return
  }
  hydratePromise = (async function hydrate() {
    try {
      if (!isTauriRuntime()) {
        cache = DEFAULT_PROMPTS.slice()
        return
      }
      const lazy = findStore()
      await lazy.init()
      const raw = await lazy.get(STORE_KEY)
      // 没写过（null/undefined）才播种；用户把库删空（[]）是明确意图，不能复活种子
      cache = raw === null || raw === undefined ? DEFAULT_PROMPTS.slice() : normalizePrompts(raw)
    } catch (error) {
      console.warn('[prompts] hydrate failed', error)
      cache = DEFAULT_PROMPTS.slice()
    } finally {
      isHydrated = true
      emit()
    }
  })()
  await hydratePromise
}

async function persist(): Promise<void> {
  if (!isTauriRuntime()) return
  try {
    const lazy = findStore()
    await lazy.init()
    await lazy.set(STORE_KEY, cache)
  } catch (error) {
    console.warn('[prompts] write failed', error)
  }
}

function getPromptsSnapshot(): readonly SavedPrompt[] {
  return snapshot
}

function subscribePrompts(listener: () => void): () => void {
  listeners.add(listener)
  return function unsubscribe() {
    listeners.delete(listener)
  }
}

/** React 侧读列表；首次挂载时触发一次磁盘 hydrate。 */
function usePrompts(): readonly SavedPrompt[] {
  useEffect(function () {
    void ensurePrompts()
  }, [])
  return useSyncExternalStore(subscribePrompts, getPromptsSnapshot, getPromptsSnapshot)
}

function findPrompt(id: string): SavedPrompt | null {
  return (
    cache.find(function (prompt) {
      return prompt.id === id
    }) ?? null
  )
}

async function createPrompt(input: { title?: string; body: string }): Promise<SavedPrompt | null> {
  await ensurePrompts()
  const body = input.body.trim()
  if (!body) return null
  const now = Date.now()
  const title = (input.title ?? '').trim() || deriveTitle(body)
  const prompt: SavedPrompt = {
    id: newID(),
    title: title.slice(0, TITLE_LIMIT),
    body,
    createdAt: now,
    updatedAt: now
  }
  cache = [prompt, ...cache].slice(0, MAX_PROMPTS)
  emit()
  await persist()
  return prompt
}

async function updatePrompt(
  id: string,
  patch: { title?: string; body?: string }
): Promise<SavedPrompt | null> {
  await ensurePrompts()
  const current = findPrompt(id)
  if (!current) return null
  const body = patch.body === undefined ? current.body : patch.body.trim()
  if (!body) return null
  const next: SavedPrompt = {
    ...current,
    body,
    title: (patch.title === undefined ? current.title : patch.title.trim()).slice(0, TITLE_LIMIT),
    updatedAt: Date.now()
  }
  cache = cache.map(function (prompt) {
    return prompt.id === id ? next : prompt
  })
  emit()
  await persist()
  return next
}

async function deletePrompt(id: string): Promise<boolean> {
  await ensurePrompts()
  const before = cache.length
  cache = cache.filter(function (prompt) {
    return prompt.id !== id
  })
  if (cache.length === before) return false
  emit()
  await persist()
  return true
}

/**
 * 测试用：重置内存态（不碰磁盘）。
 * - 传数组：直接当成已 hydrate 的库；
 * - 不传：回到「尚未 hydrate」，下一次 `ensurePrompts()` 会重新播种。
 */
function resetPromptsForTests(initial?: readonly SavedPrompt[]): void {
  cache = initial ? initial.slice() : []
  isHydrated = initial !== undefined
  hydratePromise = initial === undefined ? null : Promise.resolve()
  emit()
}

export {
  MAX_PROMPTS,
  createPrompt,
  deletePrompt,
  deriveTitle,
  ensurePrompts,
  findPrompt,
  getPromptsSnapshot,
  normalizePrompts,
  resetPromptsForTests,
  subscribePrompts,
  updatePrompt,
  usePrompts
}
