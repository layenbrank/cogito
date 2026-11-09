/**
 * monaco-editor 懒加载：同一应用内缓存单例，避免 agent diff 等路由 eager 拉整包。
 *
 * 入口从 `monaco-editor`（= `editor.main`，注册全部语言与贡献）换成
 * `esm/vs/editor/editor.api`（只有编辑器内核 API）。随之必须显式带上内核之外的贡献：
 * 查找框 / 格式化 / TS·JSON 语言服务的副作用注册都在 `lib/monaco-contribs.ts`，
 * 和内核**分开记账** —— `adoptMonaco()` 拿到的只是内核（代码窗已经静态 import 了
 * editor.api），不能因此就认为「贡献也到齐了」，否则静态引入过内核的入口会让
 * 查找框（Ctrl+F）与语言服务永远不加载。
 *
 * 语法高亮（basic-languages）在 `lib/monaco-language.ts` 里按扩展名惰性加载。
 */
import type * as Monaco from 'monaco-editor'
import type * as MonacoApi from 'monaco-editor/editor/editor.api'

type MonacoModule = typeof MonacoApi

let cached: MonacoModule | null = null
let apiTask: Promise<MonacoModule> | null = null
let contribsTask: Promise<void> | null = null

function findMonaco(): MonacoModule {
  if (!cached) {
    throw new Error('monaco-editor 尚未加载，请先 await importMonaco()')
  }
  return cached
}

/** 内核之外的贡献（查找框、格式化、TS/JSON 语言服务），只注册一次 */
function loadMonacoContribs(): Promise<void> {
  if (!contribsTask) {
    contribsTask = import('@/lib/monaco-contribs.ts').then(function () {
      return undefined
    })
  }
  return contribsTask
}

function importMonaco(): Promise<MonacoModule> {
  if (!apiTask) apiTask = import('monaco-editor/editor/editor.api')
  return Promise.all([apiTask, loadMonacoContribs()]).then(function ([api]) {
    cached = api
    return api
  })
}

/**
 * 静态入口已拉包时写入缓存，供 document-options / markers 等同步 API 使用。
 *
 * 只登记内核，**不**标记贡献已加载：`importMonaco()` 照样会去补 `monaco-contribs`。
 */
function adoptMonaco(module: MonacoModule): void {
  cached = module
  if (!apiTask) apiTask = Promise.resolve(module)
}

export type { Monaco, MonacoModule }
export { adoptMonaco, findMonaco, importMonaco, loadMonacoContribs }
