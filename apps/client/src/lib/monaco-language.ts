/**
 * monaco 语言贡献的按需注册（对齐 VS Code 的「按语言惰性激活」）。
 *
 * 根入口 `monaco-editor`（= `editor.main`）会把 ~60 种 basic-language 与全部
 * 语言服务贡献一次性注册进来，首屏解析代价与语言数量成正比。
 * 改用 `editor.api` 之后，这里按**当前打开文件的语言**逐个 `import` 对应的
 * contribution：`.py` 文件不会把 Rust / Go / PHP 的语法定义也拉下来。
 *
 * 语言服务（TS / JSON / CSS / HTML）比语法高亮贵一个量级：
 * - TypeScript / JSON 由 `monaco-loader` 随核心一起加载（TS 诊断必须就绪）
 * - CSS / HTML 在这里按需加载
 */
import { importMonaco } from '@/lib/monaco-loader.ts'

/** languageId → basic-language 贡献模块（相对 `monaco-editor/`） */
const BASIC_LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: function () {
    return import('monaco-editor/languages/definitions/typescript/register')
  },
  javascript: function () {
    return import('monaco-editor/languages/definitions/javascript/register')
  },
  markdown: function () {
    return import('monaco-editor/languages/definitions/markdown/register')
  },
  css: function () {
    return import('monaco-editor/languages/definitions/css/register')
  },
  scss: function () {
    return import('monaco-editor/languages/definitions/scss/register')
  },
  html: function () {
    return import('monaco-editor/languages/definitions/html/register')
  },
  python: function () {
    return import('monaco-editor/languages/definitions/python/register')
  },
  rust: function () {
    return import('monaco-editor/languages/definitions/rust/register')
  },
  yaml: function () {
    return import('monaco-editor/languages/definitions/yaml/register')
  },
  sql: function () {
    return import('monaco-editor/languages/definitions/sql/register')
  },
  shell: function () {
    return import('monaco-editor/languages/definitions/shell/register')
  }
}

/** 语言服务贡献：比语法高亮贵，只在这些语言真的要看时加载 */
const SERVICE_LOADERS: Record<string, () => Promise<unknown>> = {
  css: function () {
    return import('monaco-editor/language/css/monaco.contribution')
  },
  html: function () {
    return import('monaco-editor/language/html/monaco.contribution')
  }
}

const loadedLanguages = new Set<string>()
const pendingTasks = new Map<string, Promise<void>>()

/**
 * 确保某个语言的高亮 / 服务已注册；重复调用只加载一次。
 *
 * 不阻塞调用方：模型先建、贡献随后到（monaco 注册语言后会重新分词）。
 * 加载失败只打日志 —— 大不了这段时间没有高亮，不能因此让编辑器报错。
 */
function ensureMonacoLanguage(languageId: string): Promise<void> {
  if (languageId.length === 0 || loadedLanguages.has(languageId)) return Promise.resolve()

  const pending = pendingTasks.get(languageId)
  if (pending) return pending

  const loaders = [BASIC_LANGUAGE_LOADERS[languageId], SERVICE_LOADERS[languageId]].filter(
    function (loader): loader is () => Promise<unknown> {
      return typeof loader === 'function'
    }
  )
  if (loaders.length === 0) {
    loadedLanguages.add(languageId)
    return Promise.resolve()
  }

  const task = importMonaco()
    .then(function () {
      return Promise.all(loaders.map((loader) => loader()))
    })
    .then(function () {
      loadedLanguages.add(languageId)
    })
    .catch(function (error: unknown) {
      console.warn('[monaco-language] 语言贡献加载失败', languageId, error)
    })
    .finally(function () {
      pendingTasks.delete(languageId)
    })

  pendingTasks.set(languageId, task)
  return task
}

/** 已注册过的语言（调试用） */
function findLoadedLanguages(): string[] {
  return [...loadedLanguages]
}

export { ensureMonacoLanguage, findLoadedLanguages }
