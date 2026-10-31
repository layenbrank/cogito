/**
 * 文档级编辑选项：缩进与换行符。
 *
 * 状态栏要显示真实值而不是写死「空格: 2 / LF」，并且要能就地切换。
 * 这些值存在 `ITextModel` 上（每个文件各自独立），store 只是镜像。
 */
import type * as Monaco from 'monaco-editor'

import { findMonaco } from '@/lib/monaco-loader.ts'
import type { CodeIndentation, Eol } from '@/stores/code'

function readIndentation(model: Monaco.editor.ITextModel): CodeIndentation {
  const options = model.getOptions()
  return { tabSize: options.tabSize, insertSpaces: options.insertSpaces }
}

function readEol(model: Monaco.editor.ITextModel): Eol {
  return model.getEOL() === '\r\n' ? 'CRLF' : 'LF'
}

function updateIndentation(model: Monaco.editor.ITextModel, indentation: CodeIndentation): void {
  model.updateOptions({
    tabSize: indentation.tabSize,
    insertSpaces: indentation.insertSpaces
  })
}

/** 改换行符会重写全文，属真实编辑（会把文件标脏） */
function updateEol(model: Monaco.editor.ITextModel, eol: Eol): void {
  const monaco = findMonaco()
  model.setEOL(
    eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF
  )
}

export { readIndentation, readEol, updateIndentation, updateEol }
