/**
 * monaco 语言贡献的按需注册（对齐 VS Code 的「按语言惰性激活」）。
 *
 * 根入口 `monaco-editor`（= `editor.main`）会把 ~60 种 basic-language 与全部
 * 语言服务贡献一次性注册进来，首屏解析代价与语言数量成正比。
 * 改用 `editor.api` 之后，这里按**当前打开文件的语言**逐个 `import` 对应的
 * contribution：`.py` 文件不会把 Rust / Go / PHP 的语法定义也拉下来。
 *
 * 语言服务（TS / JSON / CSS / HTML）比语法高亮贵一个量级：
 * - TypeScript / JSON 由 `monaco-contribs` 随内核一起加载（TS 诊断必须就绪）
 * - CSS / HTML 在这里按需加载
 *
 * ⚠️ 顺序：**必须在创建以该语言为 languageId 的 model 之前**调用（见 `monaco-contribs`
 * 文件头的三条「一次性」说明）。`monaco-host` / `open-file` / diff 各入口都先 await 再建 model。
 */
import type * as Monaco from 'monaco-editor/editor/editor.api'

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
  less: function () {
    return import('monaco-editor/languages/definitions/less/register')
  },
  html: function () {
    return import('monaco-editor/languages/definitions/html/register')
  },
  xml: function () {
    return import('monaco-editor/languages/definitions/xml/register')
  },
  python: function () {
    return import('monaco-editor/languages/definitions/python/register')
  },
  rust: function () {
    return import('monaco-editor/languages/definitions/rust/register')
  },
  go: function () {
    return import('monaco-editor/languages/definitions/go/register')
  },
  java: function () {
    return import('monaco-editor/languages/definitions/java/register')
  },
  // 同一个模块同时注册 `c` 与 `cpp`
  c: function () {
    return import('monaco-editor/languages/definitions/cpp/register')
  },
  cpp: function () {
    return import('monaco-editor/languages/definitions/cpp/register')
  },
  csharp: function () {
    return import('monaco-editor/languages/definitions/csharp/register')
  },
  php: function () {
    return import('monaco-editor/languages/definitions/php/register')
  },
  ruby: function () {
    return import('monaco-editor/languages/definitions/ruby/register')
  },
  yaml: function () {
    return import('monaco-editor/languages/definitions/yaml/register')
  },
  ini: function () {
    return import('monaco-editor/languages/definitions/ini/register')
  },
  graphql: function () {
    return import('monaco-editor/languages/definitions/graphql/register')
  },
  kotlin: function () {
    return import('monaco-editor/languages/definitions/kotlin/register')
  },
  lua: function () {
    return import('monaco-editor/languages/definitions/lua/register')
  },
  dart: function () {
    return import('monaco-editor/languages/definitions/dart/register')
  },
  // monaco 的 protobuf 定义注册的 id 是 `proto`
  proto: function () {
    return import('monaco-editor/languages/definitions/protobuf/register')
  },
  dockerfile: function () {
    return import('monaco-editor/languages/definitions/dockerfile/register')
  },
  sql: function () {
    return import('monaco-editor/languages/definitions/sql/register')
  },
  shell: function () {
    return import('monaco-editor/languages/definitions/shell/register')
  },
  powershell: function () {
    return import('monaco-editor/languages/definitions/powershell/register')
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

/** monaco 的纯文本 languageId：没有语法贡献，永远算「就绪」 */
const PLAINTEXT = 'plaintext'

/**
 * 确保某个语言的高亮 / 服务已注册；重复调用只加载一次。
 *
 * 返回的 Promise 在「贡献已注册」时兑现 —— 调用方要在建 model 之前 await 它，
 * 否则 monaco 的「首次遇见该语言」已经被这次 model 创建消费掉了。
 *
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
    .then(function (monaco) {
      return Promise.all(
        loaders.map(function (loader) {
          return loader()
        })
      ).then(function () {
        loadedLanguages.add(languageId)
        /*
         * 兜底：注册之前就已经建好的同语言 model 需要重新分词。
         * `TokenizationRegistry.getOrCreate` 只解析「请求那一刻」已注册的工厂，model 那次的
         * 请求早于注册、不会自动重试；`editor.tokenize` 是公开 API 里唯一会触发 getOrCreate
         * 的入口，拿空串点一下就能让 token 后端重新分词（它监听 registry 的 onDidChange）。
         */
        // 单测里 `importMonaco` 被 mock 成空对象，所以这里对 editor API 做可选调用
        monaco.editor?.tokenize?.('', languageId)
      })
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

type MonacoModule = typeof Monaco

/**
 * 建 model 的兜底入口：语言贡献还没注册时先按 `plaintext` 建，注册完再切回真语言。
 *
 * 为什么不直接 `createModel(value, languageId)`？monaco 把「首次遇见某语言」记在全局
 * Set 里且只处理一次 —— 先建 model 再注册语言，语言服务与分词就永久缺席。反过来
 * 「先 plaintext、后 `setModelLanguage`」时真语言是第一次被遇见，能力齐全
 * （`setLanguage` 会重放 requestRichLanguageFeatures，并让 token 后端重置分词）。
 *
 * 常规入口（代码窗、open-file）已经先 await 过 `ensureMonacoLanguage`，走到这里
 * `loadedLanguages` 命中，等价于普通 `createModel`；这个兜底是给 diff / 旁栏这类
 * 「语言随数据变化、拿不到前置 await 点」的调用方的。
 */
function createLanguageModel(
  monaco: MonacoModule,
  value: string,
  languageId: string,
  uri?: Monaco.Uri
): Monaco.editor.ITextModel {
  if (languageId === PLAINTEXT || loadedLanguages.has(languageId)) {
    return monaco.editor.createModel(value, languageId, uri)
  }

  const model = monaco.editor.createModel(value, PLAINTEXT, uri)
  void ensureMonacoLanguage(languageId).then(function () {
    if (model.isDisposed()) return
    monaco.editor.setModelLanguage(model, languageId)
  })
  return model
}

export { createLanguageModel, ensureMonacoLanguage, findLoadedLanguages }
