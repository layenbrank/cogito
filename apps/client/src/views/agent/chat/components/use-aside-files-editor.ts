/**
 * 右栏文件 Monaco：编写体验对齐 Code（补全、格式化、括号、查找、大文件降级、TS libs）。
 */
import type * as Monaco from 'monaco-editor/editor/editor.api'
import { useEffect, useRef, useState } from 'react'

import { importMonaco } from '@/lib/monaco-loader.ts'
import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import '@/lib/monaco-environment.ts'
import { useCodeStore, type CodeEditorPrefs } from '@/stores/code'
import { findModel, findOrCreateModel, disposeModel } from '@/views/code/lib/monaco-models.ts'
import { syncWorkspaceTypescriptLibs } from '@/views/code/lib/monaco-types.ts'
import { isSamePath } from '@/views/code/lib/path.ts'

type MonacoModule = typeof Monaco

const MONACO_FONT_FAMILY =
  "'Cascadia Code', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

const EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: CODE_THEME,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: true,
  trimAutoWhitespace: true,
  largeFileOptimizations: true,
  automaticLayout: true,
  wordWrap: 'off',
  smoothScrolling: true,
  scrollBeyondLastLine: false,
  fixedOverflowWidgets: true,
  useShadowDOM: false,
  padding: { top: 8, bottom: 8 },
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  showFoldingControls: 'mouseover',
  matchBrackets: 'always',
  linkedEditing: true,
  selectionHighlight: true,
  occurrencesHighlight: 'singleFile',
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  renderLineHighlight: 'line',
  renderWhitespace: 'selection',
  renderValidationDecorations: 'on',
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  minimap: {
    enabled: true,
    maxColumn: 80,
    renderCharacters: false,
    showSlider: 'mouseover'
  },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false
  },
  bracketPairColorization: { enabled: true },
  guides: {
    bracketPairs: true,
    indentation: true,
    highlightActiveIndentation: true
  },
  stickyScroll: { enabled: true, maxLineCount: 3 },
  hover: { enabled: 'on', delay: 300 },
  links: true,
  colorDecorators: true,
  formatOnPaste: true,
  formatOnType: true,
  wordBasedSuggestions: 'currentDocument',
  quickSuggestions: { other: true, strings: true, comments: false },
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: 'smart',
  inlineSuggest: { enabled: true },
  contextmenu: true,
  find: {
    seedSearchStringFromSelection: 'selection',
    autoFindInSelection: 'never',
    findOnType: true,
    addExtraSpaceOnTop: true
  }
}

const LARGE_DOCUMENT_OPTIONS: Monaco.editor.IEditorOptions = {
  readOnly: true,
  minimap: { enabled: false },
  folding: false,
  bracketPairColorization: { enabled: false },
  guides: { bracketPairs: false, indentation: false, highlightActiveIndentation: false },
  stickyScroll: { enabled: false },
  occurrencesHighlight: 'off',
  selectionHighlight: false,
  renderWhitespace: 'none',
  codeLens: false,
  colorDecorators: false,
  matchBrackets: 'never',
  renderValidationDecorations: 'off',
  hover: { enabled: 'off' },
  links: false,
  suggestOnTriggerCharacters: false,
  quickSuggestions: false,
  inlineSuggest: { enabled: false }
}

const INTERACTIVE_DOCUMENT_OPTIONS: Monaco.editor.IEditorOptions = {
  readOnly: false,
  minimap: { enabled: true, maxColumn: 80, renderCharacters: false, showSlider: 'mouseover' },
  folding: true,
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
  stickyScroll: { enabled: true, maxLineCount: 3 },
  occurrencesHighlight: 'singleFile',
  selectionHighlight: true,
  renderWhitespace: 'selection',
  colorDecorators: true,
  matchBrackets: 'always',
  renderValidationDecorations: 'on',
  hover: { enabled: 'on', delay: 300 },
  links: true,
  suggestOnTriggerCharacters: true,
  quickSuggestions: { other: true, strings: true, comments: false },
  inlineSuggest: { enabled: true }
}

function findLineHeight(prefs: CodeEditorPrefs) {
  return Math.max(prefs.fontSize + 2, Math.round(prefs.fontSize * prefs.lineHeightRatio))
}

function toFontOptions(prefs: CodeEditorPrefs): Monaco.editor.IEditorOptions {
  return {
    fontSize: prefs.fontSize,
    lineHeight: findLineHeight(prefs),
    fontFamily: prefs.fontFamily.trim() || MONACO_FONT_FAMILY,
    fontLigatures: prefs.isLigaturesEnabled
  }
}

function releaseAsideModel(path: string) {
  const inCode = useCodeStore.getState().tabs.some(function (tab) {
    return isSamePath(tab.path, path)
  })
  if (!inCode) disposeModel(path)
}

function useAsideFilesEditor(options: {
  rootPath: string | null
  absolutePath: string | null
  relative: string | null
  content: string | null
  isPending: boolean
  isReadonly: boolean
  onSave: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<MonacoModule | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const pathRef = useRef<string | null>(null)
  const savedValueRef = useRef('')
  const [isEditorReady, updateEditorReady] = useState(false)
  const [isDirty, updateDirty] = useState(false)
  const onSaveRef = useRef(options.onSave)
  const editorPrefs = useCodeStore(function (state) {
    return state.editorPrefs
  })

  useEffect(
    function () {
      onSaveRef.current = options.onSave
    },
    [options.onSave]
  )

  useEffect(
    function () {
      if (!options.rootPath) return
      void syncWorkspaceTypescriptLibs([options.rootPath]).catch(function (error: unknown) {
        console.error('[agent/aside-files] 同步 TS libs 失败', error)
      })
    },
    [options.rootPath]
  )

  useEffect(
    function () {
      const host = hostRef.current
      if (!host) return

      let cancelled = false
      let editor: Monaco.editor.IStandaloneCodeEditor | null = null
      let stopThemeWatch: (() => void) | null = null
      const disposables: Monaco.IDisposable[] = []

      void importMonaco().then(function (monaco) {
        if (cancelled) return
        monacoRef.current = monaco
        syncCodeTheme()
        // 字体由下方 editorPrefs effect 写入，避免 mount 闭包依赖
        editor = monaco.editor.create(host, EDITOR_OPTIONS)
        editorRef.current = editor
        disposables.push(
          editor.addAction({
            id: 'aside-files-save',
            label: '保存',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
            run() {
              onSaveRef.current()
            }
          })
        )
        disposables.push(
          editor.addAction({
            id: 'aside-files-format',
            label: '格式化文档',
            keybindings: [
              monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
              monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI
            ],
            run(ed) {
              void ed.getAction('editor.action.formatDocument')?.run()
            }
          })
        )
        stopThemeWatch = watchCodeTheme()
        updateEditorReady(true)
        requestAnimationFrame(function () {
          editor?.layout()
          editor?.focus()
        })
      })

      return function () {
        cancelled = true
        updateEditorReady(false)
        stopThemeWatch?.()
        for (const item of disposables) item.dispose()
        editor?.setModel(null)
        editor?.dispose()
        editorRef.current = null
        monacoRef.current = null
        if (pathRef.current) {
          releaseAsideModel(pathRef.current)
          pathRef.current = null
        }
      }
    },
    []
  )

  useEffect(
    function () {
      const editor = editorRef.current
      if (!editor || !isEditorReady) return
      if (
        options.isPending ||
        options.content === null ||
        !options.relative ||
        !options.absolutePath
      ) {
        editor.setModel(null)
        if (pathRef.current) {
          releaseAsideModel(pathRef.current)
          pathRef.current = null
        }
        updateDirty(false)
        return
      }

      const previousPath = pathRef.current
      if (previousPath && !isSamePath(previousPath, options.absolutePath)) {
        releaseAsideModel(previousPath)
      }

      const model = findOrCreateModel(options.absolutePath, options.content)
      pathRef.current = options.absolutePath
      savedValueRef.current = options.content
      editor.setModel(model)
      // 模型挂上之后再灌类型：工程里没有 TS/JS 模型时同步会直接跳过（见 monaco-types）
      if (options.rootPath) {
        void syncWorkspaceTypescriptLibs([options.rootPath]).catch(function (error: unknown) {
          console.error('[agent/aside-files] 同步 TS libs 失败', error)
        })
      }
      editor.updateOptions(
        options.isReadonly ? LARGE_DOCUMENT_OPTIONS : INTERACTIVE_DOCUMENT_OPTIONS
      )
      updateDirty(model.getValue() !== savedValueRef.current)
      requestAnimationFrame(function () {
        editor.layout()
        editor.focus()
      })

      const disposable = model.onDidChangeContent(function () {
        updateDirty(model.getValue() !== savedValueRef.current)
      })
      return function () {
        disposable.dispose()
      }
    },
    [
      options.content,
      options.relative,
      options.absolutePath,
      options.isPending,
      options.isReadonly,
      // rootPath 换了要重新灌一次类型库（换工作区就是另一份 @types）
      options.rootPath,
      isEditorReady
    ]
  )

  useEffect(
    function () {
      editorRef.current?.updateOptions(toFontOptions(editorPrefs))
    },
    [editorPrefs]
  )

  function findValue() {
    const path = pathRef.current
    if (path) {
      const model = findModel(path)
      if (model) return model.getValue()
    }
    return editorRef.current?.getValue() ?? ''
  }

  function markSaved(value: string) {
    savedValueRef.current = value
    updateDirty(false)
  }

  function formatDocument() {
    const editor = editorRef.current
    if (!editor || options.isReadonly) return
    void editor.getAction('editor.action.formatDocument')?.run()
  }

  return { hostRef, isDirty, findValue, markSaved, formatDocument }
}

export { useAsideFilesEditor }
