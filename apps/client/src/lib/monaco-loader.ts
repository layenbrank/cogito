/**
 * monaco-editor 懒加载：同一应用内缓存单例，避免 agent diff 等路由 eager 拉整包。
 *
 * 入口从 `monaco-editor`（= `editor.main`，注册全部语言与贡献）换成
 * `esm/vs/editor/editor.api`（只有编辑器内核 API）。随之必须显式带上
 * **语言服务**贡献：`monaco.typescript` / `monaco.json` 的命名空间不是编辑器内核，
 * 而是由 `esm/vs/language` 下的 `monaco.contribution` 注入的（注释里别写星号斜杠）
 * 语法高亮（basic-languages）在 `lib/monaco-language.ts` 里按扩展名惰性加载。
 */
import type * as Monaco from 'monaco-editor'
import type * as MonacoApi from 'monaco-editor/editor/editor.api'

type MonacoModule = typeof MonacoApi

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
    loadTask = (async function () {
      // typescript / json 是「诊断与校验」所必需，跟核心一起到位；
      // css / html 服务与各语言的语法高亮在 monaco-language.ts 里按需加载
      const [api] = await Promise.all([
        import('monaco-editor/editor/editor.api'),
        import('monaco-editor/language/typescript/monaco.contribution'),
        import('monaco-editor/language/json/monaco.contribution')
      ])
      cached = api
      return api
    })()
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

export type { Monaco, MonacoModule }
export { adoptMonaco, findMonaco, importMonaco }
