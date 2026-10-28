import { cn } from 'cn'
import * as monaco from 'monaco-editor'
// 0.56+ 起导出映射为 ./esm/vs/*.js，子路径不再带 esm/vs 前缀；
// 根入口已注册全部 basic-languages 与语言特性，无需逐个 import contribution。
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { useEffect, useRef } from 'react'

import { useCodeStore } from '@/stores/code'
import { findModel, findOrCreateModel, findPathForModel } from '@/views/code/lib/monaco-models.ts'
import { readCodeFile } from '@/views/code/lib/fs.ts'

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string): Worker {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: 'vs-dark',
  fontSize: 13,
  lineHeight: 20,
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
  padding: { top: 4, bottom: 4 },
  renderLineHighlight: 'line',
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  formatOnPaste: true,
  formatOnType: true,
  quickSuggestions: { other: true, strings: true, comments: false },
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: 'smart',
  inlineSuggest: { enabled: true },
  contextmenu: true,
  stickyScroll: { enabled: true }
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

interface MonacoHostProps {
  className?: string
}

function MonacoHost(props: MonacoHostProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTab = tabs.find(function (tab) {
    return tab.id === activeTabId
  })

  useEffect(function () {
    const host = hostRef.current
    if (!host) return

    monaco.editor.setTheme(isDarkMode() ? 'vs-dark' : 'vs')
    const editor = monaco.editor.create(host, EDITOR_OPTIONS)
    editorRef.current = editor

    const themeObserver = new MutationObserver(function () {
      monaco.editor.setTheme(isDarkMode() ? 'vs-dark' : 'vs')
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })

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
      const model = editor.getModel()
      if (!model) return
      const markers = monaco.editor.getModelMarkers({ resource: model.uri })
      useCodeStore.getState().toSetProblemCount(markers.length)
    })

    requestAnimationFrame(function () {
      editor.layout()
    })

    return function () {
      themeObserver.disconnect()
      subCursor.dispose()
      subContent.dispose()
      subMarkers.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(
    function () {
      const editor = editorRef.current
      if (!editor) return
      if (!activeTab) {
        editor.setModel(null)
        useCodeStore.getState().toSetProblemCount(0)
        return
      }

      let cancelled = false
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
        if (cancelled || !editorRef.current) return
        if (editorRef.current.getModel() !== model) {
          editorRef.current.setModel(model)
        }
        useCodeStore.getState().toSetLanguageId(activeTab.language)
        const markers = monaco.editor.getModelMarkers({ resource: model.uri })
        useCodeStore.getState().toSetProblemCount(markers.length)
        requestAnimationFrame(function () {
          editorRef.current?.focus()
          editorRef.current?.layout()
        })
      })()

      return function () {
        cancelled = true
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