/**
 * Monaco model 注册表：多 tab 共享单 editor，按 path 复用 ITextModel。
 */
import * as monaco from 'monaco-editor'

import { findLanguageId } from '@/views/code/lib/language.ts'

const modelsByPath = new Map<string, monaco.editor.ITextModel>()
const pathByModel = new WeakMap<monaco.editor.ITextModel, string>()

function pathToUri(path: string): monaco.Uri {
  const normalized = path.replace(/\\/g, '/')
  return monaco.Uri.file(normalized)
}

function findOrCreateModel(path: string, value: string): monaco.editor.ITextModel {
  const existing = modelsByPath.get(path)
  if (existing && !existing.isDisposed()) {
    if (existing.getValue() !== value) {
      existing.setValue(value)
    }
    return existing
  }

  const language = findLanguageId(path)
  const uri = pathToUri(path)
  const prior = monaco.editor.getModel(uri)
  if (prior && !prior.isDisposed()) {
    prior.setValue(value)
    monaco.editor.setModelLanguage(prior, language)
    modelsByPath.set(path, prior)
    pathByModel.set(prior, path)
    return prior
  }

  const model = monaco.editor.createModel(value, language, uri)
  modelsByPath.set(path, model)
  pathByModel.set(model, path)
  return model
}

function findModel(path: string): monaco.editor.ITextModel | null {
  const model = modelsByPath.get(path)
  if (!model || model.isDisposed()) {
    modelsByPath.delete(path)
    return null
  }
  return model
}

function findPathForModel(model: monaco.editor.ITextModel): string | null {
  return pathByModel.get(model) ?? null
}

function disposeModel(path: string): void {
  const model = modelsByPath.get(path)
  if (!model) return
  modelsByPath.delete(path)
  if (!model.isDisposed()) model.dispose()
}

/** 重命名后迁移 model：复制内容到新 URI，销毁旧 model */
function relocateModel(fromPath: string, toPath: string): monaco.editor.ITextModel | null {
  const existing = findModel(fromPath)
  if (!existing) return null
  const value = existing.getValue()
  disposeModel(fromPath)
  return findOrCreateModel(toPath, value)
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
