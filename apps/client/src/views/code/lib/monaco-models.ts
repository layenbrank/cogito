/**
 * Monaco model 注册表：多 tab 共享单 editor，按 path 复用 ITextModel。
 *
 * 对 monaco 只留类型引用，运行时统一走 `findMonaco()` 取已加载的内核 ——
 * 一个静态 `import * as monaco` 就足以把整个编辑器内核（≈2 MB）拽进
 * 任何引用本模块的 chunk，右栏 diff 所在的对话页会白背一份。
 */
import type * as Monaco from 'monaco-editor/editor/editor.api'

import { createLanguageModel } from '@/lib/monaco-language.ts'
import { findMonaco } from '@/lib/monaco-loader.ts'
import { findLanguageId } from '@/views/code/lib/language.ts'

const modelsByPath = new Map<string, Monaco.editor.ITextModel>()
const pathByModel = new WeakMap<Monaco.editor.ITextModel, string>()

function pathToUri(path: string): Monaco.Uri {
  const normalized = path.replace(/\\/g, '/')
  return findMonaco().Uri.file(normalized)
}

function findOrCreateModel(
  path: string,
  value: string,
  options: { force?: boolean } = {}
): Monaco.editor.ITextModel {
  const monaco = findMonaco()
  const existing = modelsByPath.get(path)
  if (existing && !existing.isDisposed()) {
    // 默认不覆盖缓冲区：点开已打开且有未保存改动的文件时，磁盘内容不能顶掉内存
    if (options.force && existing.getValue() !== value) {
      existing.setValue(value)
    }
    return existing
  }

  const language = findLanguageId(path)
  const uri = pathToUri(path)
  const prior = monaco.editor.getModel(uri)
  if (prior && !prior.isDisposed()) {
    if (options.force && prior.getValue() !== value) {
      prior.setValue(value)
    }
    monaco.editor.setModelLanguage(prior, language)
    modelsByPath.set(path, prior)
    pathByModel.set(prior, path)
    return prior
  }

  // 语言贡献没就绪时先按 plaintext 建、注册完再切回（见 createLanguageModel）
  const model = createLanguageModel(monaco, value, language, uri)
  modelsByPath.set(path, model)
  pathByModel.set(model, path)
  return model
}

function findModel(path: string): Monaco.editor.ITextModel | null {
  const model = modelsByPath.get(path)
  if (!model || model.isDisposed()) {
    modelsByPath.delete(path)
    return null
  }
  return model
}

function findPathForModel(model: Monaco.editor.ITextModel): string | null {
  return pathByModel.get(model) ?? null
}

function disposeModel(path: string): void {
  const model = modelsByPath.get(path)
  if (!model) return
  modelsByPath.delete(path)
  if (!model.isDisposed()) model.dispose()
}

/** 重命名后迁移 model：复制内容到新 URI，销毁旧 model */
function relocateModel(fromPath: string, toPath: string): Monaco.editor.ITextModel | null {
  const existing = findModel(fromPath)
  if (!existing) return null
  const value = existing.getValue()
  disposeModel(fromPath)
  return findOrCreateModel(toPath, value, { force: true })
}

function disposeAllModels(): void {
  for (const model of modelsByPath.values()) {
    if (!model.isDisposed()) model.dispose()
  }
  modelsByPath.clear()
}

export {
  findOrCreateModel,
  findModel,
  findPathForModel,
  disposeModel,
  relocateModel,
  disposeAllModels
}
