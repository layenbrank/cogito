/**
 * monaco-editor 懒加载：同一应用内缓存单例，避免 agent diff 等路由 eager 拉整包。
 */
import type * as Monaco from 'monaco-editor'

type MonacoModule = typeof Monaco

let cached: MonacoModule | null = null
let loadTask: Promise<MonacoModule> | null = null

function findMonaco(): MonacoModule {
  if (!cached) {
    throw new Error('monaco-editor 尚未加载，请先 await importMonaco()')
  }
  return cached
}

function importMonaco(): Promise<MonacoModule> {
  if (cached) return Promise.resolve(cached)
  if (!loadTask) {
    loadTask = import('monaco-editor').then(function (mod) {
      cached = mod
      return mod
    })
  }
  return loadTask
}

/** 静态入口已拉包时写入缓存，供 document-options / markers 等同步 API 使用 */
function adoptMonaco(module: MonacoModule): void {
  cached = module
  if (!loadTask) {
    loadTask = Promise.resolve(module)
  }
}

export type { Monaco }
export { adoptMonaco, findMonaco, importMonaco }
