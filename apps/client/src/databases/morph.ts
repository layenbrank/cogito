/**
 * Morph 批注本地持久化（Tauri LazyStore，不进 corex）。
 * 键：`annotations:<path>` → Morph.Annotation[]
 */
import { LazyStore } from '@tauri-apps/plugin-store'

const STORE_FILE = 'morph.json'

let store: LazyStore | null = null
let hydratePromise: Promise<void> | null = null

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
}

function annotationKey(path: string): string {
  return `annotations:${path}`
}

async function ensureStore(): Promise<LazyStore | null> {
  if (!isTauriRuntime()) return null
  if (store) return store
  if (hydratePromise) {
    await hydratePromise
    return store
  }
  hydratePromise = (async function () {
    store = new LazyStore(STORE_FILE, { autoSave: 250 })
    await store.init()
  })()
  await hydratePromise
  return store
}

function isAnnotation(value: unknown): value is Morph.Annotation {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.path === 'string' &&
    typeof row.offset === 'number' &&
    typeof row.type === 'string' &&
    row.rect !== undefined &&
    row.data !== undefined
  )
}

async function queryAnnotations(path: string): Promise<Morph.Annotation[]> {
  const db = await ensureStore()
  if (!db) return []
  const raw = await db.get(annotationKey(path))
  if (!Array.isArray(raw)) return []
  return raw.filter(isAnnotation)
}

async function countAnnotationsByPage(path: string): Promise<Record<number, number>> {
  const annotations = await queryAnnotations(path)
  const counts: Record<number, number> = {}
  for (const ann of annotations) {
    counts[ann.offset] = (counts[ann.offset] ?? 0) + 1
  }
  return counts
}

async function writeAnnotations(path: string, annotations: Morph.Annotation[]): Promise<void> {
  const db = await ensureStore()
  if (!db) return
  await db.set(annotationKey(path), annotations)
}

async function insertAnnotation(annotation: Morph.Annotation): Promise<void> {
  const current = await queryAnnotations(annotation.path)
  current.push(annotation)
  await writeAnnotations(annotation.path, current)
}

async function updateAnnotation(
  id: string,
  changes: Partial<Pick<Morph.Annotation, 'rect' | 'data'>>
): Promise<void> {
  const db = await ensureStore()
  if (!db) return
  const entries = await db.entries()
  for (const [key, value] of entries) {
    if (!key.startsWith('annotations:') || !Array.isArray(value)) continue
    const annotations = value.filter(isAnnotation)
    const idx = annotations.findIndex(function (a) {
      return a.id === id
    })
    if (idx < 0) continue
    const next = {
      ...annotations[idx],
      ...changes,
      updatedAt: Date.now()
    }
    annotations[idx] = next
    await db.set(key, annotations)
    return
  }
}

async function removeAnnotation(id: string): Promise<void> {
  const db = await ensureStore()
  if (!db) return
  const entries = await db.entries()
  for (const [key, value] of entries) {
    if (!key.startsWith('annotations:') || !Array.isArray(value)) continue
    const annotations = value.filter(isAnnotation)
    const next = annotations.filter(function (a) {
      return a.id !== id
    })
    if (next.length === annotations.length) continue
    await db.set(key, next)
    return
  }
}

async function upsertFile(_meta: Morph.Meta): Promise<void> {
  // 预留：当前仅持久化批注；文档元信息以每次 toMeta 为准
}

export {
  countAnnotationsByPage,
  insertAnnotation,
  queryAnnotations,
  removeAnnotation,
  updateAnnotation,
  upsertFile
}
