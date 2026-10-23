/**
 * 非密偏好真源：Tauri LazyStore + 内存 cache。
 * 启动 `ensurePersist()` 后，`findPref` 可同步读。
 * 非 Tauri（vitest / 浏览器预览）只走内存，不碰磁盘。
 */
import { LazyStore } from '@tauri-apps/plugin-store'

import { STORE_FILE, type PersistNamespace } from '@/features/persist/files'
import { cloneDefaults, parseNamespace } from '@/features/persist/parse'
import type { PersistShape, PersistValue } from '@/features/persist/types'

const NAMESPACES = Object.keys(STORE_FILE) as PersistNamespace[]

const stores = new Map<PersistNamespace, LazyStore>()
let cache: PersistShape = cloneDefaults()
let isReady = false
let hydratePromise: Promise<void> | null = null

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

function findStore(ns: PersistNamespace): LazyStore {
  let store = stores.get(ns)
  if (store) return store
  store = new LazyStore(STORE_FILE[ns], {
    defaults: cache[ns] as unknown as Record<string, unknown>,
    autoSave: 250
  })
  stores.set(ns, store)
  return store
}

async function loadNamespace<N extends PersistNamespace>(ns: N): Promise<void> {
  const store = findStore(ns)
  await store.init()
  // 整文件以单键 `value` 存一份对象，避免与旧 settings 多键格式混用时半读
  // settings 保持多键（general/capture/shortcuts）以贴合现有 setting store
  if (ns === 'settings') {
    const [general, capture, shortcuts] = await Promise.all([
      store.get('general'),
      store.get('capture'),
      store.get('shortcuts')
    ])
    cache.settings = parseNamespace('settings', { general, capture, shortcuts })
    return
  }
  const raw = await store.get('value')
  cache[ns] = parseNamespace(ns, raw ?? null)
}

async function ensurePersist(): Promise<void> {
  if (isReady) return
  if (hydratePromise) {
    await hydratePromise
    return
  }
  hydratePromise = (async function () {
    try {
      if (!isTauriRuntime()) {
        cache = cloneDefaults()
        return
      }
      await Promise.all(
        NAMESPACES.map(function (ns) {
          return loadNamespace(ns)
        })
      )
    } catch (error) {
      console.warn('[persist] hydrate failed', error)
      cache = cloneDefaults()
    } finally {
      isReady = true
    }
  })()
  await hydratePromise
}

function findPref<N extends PersistNamespace>(ns: N): PersistValue<N> {
  return structuredClone(cache[ns])
}

async function writeNamespace<N extends PersistNamespace>(ns: N, value: PersistValue<N>): Promise<void> {
  if (!isTauriRuntime()) return
  const store = findStore(ns)
  await store.init()
  if (ns === 'settings') {
    const settings = value as PersistShape['settings']
    await Promise.all([
      store.set('general', settings.general),
      store.set('capture', settings.capture),
      store.set('shortcuts', settings.shortcuts)
    ])
    return
  }
  await store.set('value', value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 一层深合并：tiles.markdown / signboard.viewModeByBoard 等可局部 patch */
function mergePatch(current: unknown, patch: unknown): unknown {
  if (!isPlainRecord(current) || !isPlainRecord(patch)) return patch
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    const prior = current[key]
    if (isPlainRecord(prior) && isPlainRecord(value)) {
      next[key] = { ...prior, ...value }
    } else {
      next[key] = value
    }
  }
  return next
}

async function patchPref<N extends PersistNamespace>(
  ns: N,
  patch: Partial<PersistValue<N>> | PersistValue<N>
): Promise<PersistValue<N>> {
  await ensurePersist()
  const current = cache[ns]
  const merged = mergePatch(current, patch)
  const next = parseNamespace(ns, merged)
  cache[ns] = next
  try {
    await writeNamespace(ns, next)
  } catch (error) {
    console.warn(`[persist] write ${ns} failed`, error)
  }
  return structuredClone(next)
}

/** 整段替换某一 namespace（clipchamp 工程等） */
async function replacePref<N extends PersistNamespace>(ns: N, value: PersistValue<N>): Promise<void> {
  await ensurePersist()
  const next = parseNamespace(ns, value)
  cache[ns] = next
  try {
    await writeNamespace(ns, next)
  } catch (error) {
    console.warn(`[persist] replace ${ns} failed`, error)
  }
}

function isPersistReady(): boolean {
  return isReady
}

/** 测试用：重置内存 cache（不碰磁盘） */
function resetPersistForTests(): void {
  cache = cloneDefaults()
  isReady = true
  hydratePromise = Promise.resolve()
}

export {
  ensurePersist,
  findPref,
  patchPref,
  replacePref,
  isPersistReady,
  resetPersistForTests
}
