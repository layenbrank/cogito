/**
 * Overview 已选搜索引擎：localStorage 同步读写
 */
import { ENGINE_STORE_KEY, ENGINES, findEngine } from '@/constants/engine'

function parseEngineKey(value: unknown): string {
  if (!value || typeof value !== 'object') return ENGINES[0].key
  const key = (value as { key?: unknown }).key
  if (typeof key !== 'string') return ENGINES[0].key
  const known = ENGINES.some(function (engine) {
    return engine.key === key
  })
  return known ? key : ENGINES[0].key
}

function readEngineKey(): string {
  if (typeof localStorage === 'undefined') return ENGINES[0].key
  try {
    const raw = localStorage.getItem(ENGINE_STORE_KEY)
    if (!raw) return ENGINES[0].key
    return parseEngineKey(JSON.parse(raw) as unknown)
  } catch {
    return ENGINES[0].key
  }
}

function writeEngineKey(key: string): void {
  if (typeof localStorage === 'undefined') return
  const engine = findEngine(key)
  localStorage.setItem(ENGINE_STORE_KEY, JSON.stringify({ key: engine.key }))
}

export { parseEngineKey, readEngineKey, writeEngineKey }
