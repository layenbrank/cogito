import { cn } from 'cn'
import * as monaco from 'monaco-editor/editor/editor.api'
import { useEffect, useRef } from 'react'

// 贡献（查找框 / 格式化 / 补全 / TS·JSON 语言服务）与 worker 装配：都静态引入，
// 赶在首个 editor 创建之前生效 —— monaco 的注册表是「创建时快照」，晚到的贡献不会回放。
// 这里特意不用根入口 `monaco-editor`（editor.main）：它会连带静态打进 ~60 种语言定义、
// 我们用不到的 standalone 命令与 lsp 客户端，而语言定义本来就按扩展名动态加载（monaco-language）
import '@/lib/monaco-contribs.ts'
import '@/lib/monaco-environment.ts'
import { adoptMonaco } from '@/lib/monaco-loader.ts'
import { useCodeStore } from '@/stores/code'
import { readCodeFile } from '@/views/code/lib/fs.ts'
import { pushProblemCounts } from '@/views/code/lib/monaco-markers.ts'
import { findModel, findOrCreateModel, findPathForModel } from '@/views/code/lib/monaco-models.ts'

// 代码页静态拉的是编辑器内核：登记给懒加载方（monaco-models / monaco-theme 只认 findMonaco），
// 免得右栏 diff 与代码页各 import 一份内核
adoptMonaco(monaco)

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
  /** 宿主从隐藏（设置 / 提交历史盖住）恢复显示：容器尺寸从 0 变回来，要重新量一次 */
  isActive?: boolean
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
      // 计数口径统一在 `monaco-markers`：状态栏与问题面板共用一份，避免两处互相覆盖
      pushProblemCounts(editor.getModel())
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
        pushProblemCounts(null)
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
        pushProblemCounts(model)
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

  // 被 `hidden` 盖住时容器尺寸是 0，重新露出必须再量一次；
  // 只靠 `automaticLayout` 对 display:none 的切换并不可靠。
  useEffect(
    function () {
      if (!props.isActive) return
      const editor = editorRef.current
      if (!editor) return
      requestAnimationFrame(function () {
        editor.layout()
      })
    },
    [props.isActive]
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
