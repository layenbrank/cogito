import { cn } from 'cn'
import * as monaco from 'monaco-editor'
// 0.56+ 起导出映射为 ./esm/vs/*.js，子路径不再带 esm/vs 前缀；
// 根入口已注册全部 basic-languages 与语言特性，无需逐个 import contribution。
import { useEffect, useRef } from 'react'

import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import { useCodeStore, type CodeEditorPrefs } from '@/stores/code'
import { readEol, readIndentation } from '@/views/code/lib/document-options.ts'
import { isLargeDocument } from '@/views/code/lib/file-limits.ts'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { findModel, findOrCreateModel, findPathForModel } from '@/views/code/lib/monaco-models.ts'
import { pushProblemCounts } from '@/views/code/lib/monaco-markers.ts'
import { attachEditor, detachEditor } from '@/views/code/lib/monaco-instance.ts'
import { isSamePath } from '@/views/code/lib/path.ts'
import { restoreViewState, saveViewState } from '@/views/code/lib/monaco-view-state.ts'
// worker 装配只有一份，见 lib/monaco-environment.ts
import '@/lib/monaco-environment.ts'

/** 系统装了哪套等宽字体不可知，按流行度排一个栈，取第一个存在的 */
const MONACO_FONT_FAMILY =
  "'Cascadia Code', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
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
  /*
   * Monaco 把 --vscode-* 主题变量只声明在 .monaco-editor / .monaco-component 上。
   * 同时开 fixedOverflowWidgets 时，右键菜单会被放进 shadow root，而 shadow host
   * 挂在宿主 div（#monacoGraph）上，继承不到这些变量 → 菜单背景/前景全变透明。
   * 关掉 shadow DOM 后菜单直接挂进宿主 div，靠自身的 .monaco-component 取到变量。
   */
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
  /*
   * 查找/替换：选中即带入关键词、不自动限定范围、系统剪贴板也能作为搜索词。
   * 键位由 Monaco 原生接管（Ctrl+F / Ctrl+H），不注册到全局派发器，避免双触发。
   */
  find: {
    seedSearchStringFromSelection: 'selection',
    autoFindInSelection: 'never',
    findOnType: true,
    addExtraSpaceOnTop: true
  }
}

/** 大文件：只读 + 关掉所有随文档规模放大的装饰 */
const LARGE_DOCUMENT_OPTIONS: monaco.editor.IEditorOptions = {
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

/** 普通文档：把大文件模式关掉的项逐项恢复 */
const INTERACTIVE_DOCUMENT_OPTIONS: monaco.editor.IEditorOptions = {
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

/** 行高取整且必须大于字号，否则 Monaco 会拒绝该选项 */
function findLineHeight(prefs: CodeEditorPrefs): number {
  return Math.max(prefs.fontSize + 2, Math.round(prefs.fontSize * prefs.lineHeightRatio))
}

function toFontOptions(prefs: CodeEditorPrefs): monaco.editor.IEditorOptions {
  return {
    fontSize: prefs.fontSize,
    lineHeight: findLineHeight(prefs),
    fontFamily: prefs.fontFamily.trim() || MONACO_FONT_FAMILY,
    fontLigatures: prefs.isLigaturesEnabled
  }
}

/** 把待定位请求落到当前 model 上；路径不匹配则留待下一次切模型 */
function syncPendingReveal(editor: monaco.editor.IStandaloneCodeEditor, model: monaco.editor.ITextModel): void {
  const request = useCodeStore.getState().pendingReveal
  if (!request) return
  const path = findPathForModel(model)
  if (!path || !isSamePath(path, request.path)) return
  const position = { lineNumber: request.line, column: request.column }
  editor.setPosition(position)
  editor.revealPositionInCenter(position)
  editor.focus()
  useCodeStore.getState().toRequestReveal(null)
}

interface MonacoHostProps {
  className?: string
  /** 被差异层盖住时为 false：从 hidden 恢复后补一次 layout */
  isActive?: boolean
}

function MonacoHost(props: MonacoHostProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const isActive = props.isActive !== false
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const editorPrefs = useCodeStore(function (state) {
    return state.editorPrefs
  })
  const pendingReveal = useCodeStore(function (state) {
    return state.pendingReveal
  })
  const activeTab = tabs.find(function (tab) {
    return tab.id === activeTabId
  })

  useEffect(function () {
    const host = hostRef.current
    if (!host) return

    // 主题依赖 :root / .dark 上的 token，必须在 DOM 就绪后先 define 再 create
    syncCodeTheme()
    const editor = monaco.editor.create(host, {
      ...EDITOR_OPTIONS,
      ...toFontOptions(useCodeStore.getState().editorPrefs)
    })
    editorRef.current = editor
    attachEditor(editor)

    const stopThemeWatch = watchCodeTheme()

    const subCursor = editor.onDidChangeCursorPosition(function (event) {
      useCodeStore.getState().toSetCursor({
        line: event.position.lineNumber,
        column: event.position.column
      })
    })

    const subContent = editor.onDidChangeModelContent(function () {
      const model = editor.getModel()
      if (!model) return
      const path = findPathForModel(model)
      if (!path) return
      const tab = useCodeStore.getState().tabs.find(function (item) {
        return item.path === path
      })
      if (!tab) return
      useCodeStore.getState().toMarkDirty(tab.id, true)
    })

    const subMarkers = monaco.editor.onDidChangeMarkers(function () {
      pushProblemCounts(editor.getModel())
    })

    requestAnimationFrame(function () {
      editor.layout()
    })

    return function () {
      stopThemeWatch()
      subCursor.dispose()
      subContent.dispose()
      subMarkers.dispose()
      detachEditor(editor)
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  // 外观偏好变化（字号/行高/字体/连字）即时生效
  useEffect(
    function () {
      editorRef.current?.updateOptions(toFontOptions(editorPrefs))
    },
    [editorPrefs]
  )

  // 差异层关掉后宿主从 display:none 回来，ResizeObserver 不一定立刻补布局
  useEffect(
    function () {
      if (!isActive) return
      const editor = editorRef.current
      if (!editor) return
      requestAnimationFrame(function () {
        editor.layout()
      })
    },
    [isActive]
  )

  // 同一文件内再次点搜索结果时，模型没换过，靠这个副作用重新定位
  useEffect(
    function () {
      if (!pendingReveal) return
      const editor = editorRef.current
      const model = editor?.getModel()
      if (!editor || !model) return
      syncPendingReveal(editor, model)
    },
    [pendingReveal]
  )

  useEffect(
    function () {
      const editor = editorRef.current
      if (!editor) return

      // 切走前先记住滚动位置、选区与折叠状态
      const previousModel = editor.getModel()
      if (previousModel) {
        const previousPath = findPathForModel(previousModel)
        if (previousPath) saveViewState(previousPath, editor)
      }

      if (!activeTab) {
        editor.setModel(null)
        pushProblemCounts(null)
        useCodeStore.getState().toSetLargeFile(false)
        return
      }

      let cancelled = false
      let subModelOptions: monaco.IDisposable | null = null

      void (async function () {
        let model = findModel(activeTab.path)
        if (!model) {
          try {
            const content = await readCodeFile(activeTab.path)
            if (cancelled) return
            model = findOrCreateModel(activeTab.path, content)
            useCodeStore.getState().toMarkDirty(activeTab.id, false)
          } catch (error) {
            console.error('[code] reload model failed', error)
            return
          }
        }
        const activeEditor = editorRef.current
        if (cancelled || !activeEditor) return

        // 大文件只读 + 关掉随规模放大的装饰；切回普通文件逐项还原
        const isLarge = isLargeDocument(model)
        activeEditor.updateOptions(isLarge ? LARGE_DOCUMENT_OPTIONS : INTERACTIVE_DOCUMENT_OPTIONS)
        useCodeStore.getState().toSetLargeFile(isLarge)

        if (activeEditor.getModel() !== model) {
          activeEditor.setModel(model)
          restoreViewState(activeTab.path, activeEditor)
        }
        syncPendingReveal(activeEditor, model)

        const store = useCodeStore.getState()
        store.toSetLanguageId(activeTab.language)
        store.toSetIndentation(readIndentation(model))
        store.toSetEol(readEol(model))
        pushProblemCounts(model)

        // 自动缩进检测与手动切换都会改选项卡，状态栏要跟着变
        subModelOptions = model.onDidChangeOptions(function () {
          const current = useCodeStore.getState()
          current.toSetIndentation(readIndentation(model))
          current.toSetEol(readEol(model))
        })

        requestAnimationFrame(function () {
          activeEditor.focus()
          activeEditor.layout()
        })
      })()

      return function () {
        cancelled = true
        subModelOptions?.dispose()
      }
    },
    [activeTab]
  )

  return (
    <div
      ref={hostRef}
      id="monacoGraph"
      className={cn('size-full min-h-0 bg-background/93', props.className)}
    />
  )
}

export { MonacoHost }