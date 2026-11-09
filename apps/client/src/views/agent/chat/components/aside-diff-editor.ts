/**
 * 右栏 Diff Monaco：选项对齐 Code 的 useDiffMonacoEditor，
 * 窄栏固定 inline；字号/行高跟随 editorPrefs。
 */
import type * as Monaco from 'monaco-editor/editor/editor.api'
import { useEffect, useRef, useState } from 'react'

import { createLanguageModel } from '@/lib/monaco-language.ts'
import { importMonaco } from '@/lib/monaco-loader.ts'
import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import type { DiffResult } from '@/lib/workspace-git'
import { useCodeStore } from '@/stores/code'
import { findLanguageId } from '@/views/code/lib/language.ts'

type MonacoModule = typeof Monaco

function findOriginalUri(relative: string, monaco: MonacoModule): Monaco.Uri {
  return monaco.Uri.parse(`inmemory://agent-aside-original/${encodeURIComponent(relative)}`)
}

function findLineHeight(fontSize: number, lineHeightRatio: number) {
  return Math.max(fontSize + 2, Math.round(fontSize * lineHeightRatio))
}

function useAsideDiffEditor(relative: string, side: DiffResult | null) {
  const hostRef = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<MonacoModule | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<Monaco.editor.ITextModel[]>([])
  const [isEditorReady, updateEditorReady] = useState(false)
  const editorPrefs = useCodeStore(function (state) {
    return state.editorPrefs
  })

  useEffect(
    function () {
      const host = hostRef.current
      if (!host) return

      let cancelled = false
      let editor: Monaco.editor.IStandaloneDiffEditor | null = null
      let stopThemeWatch: (() => void) | null = null

      void importMonaco().then(function (monaco) {
        if (cancelled) return
        monacoRef.current = monaco
        syncCodeTheme()
        // 字号/行高由下方 editorPrefs effect 写入，避免 mount 闭包依赖
        editor = monaco.editor.createDiffEditor(host, {
          theme: CODE_THEME,
          readOnly: true,
          originalEditable: false,
          automaticLayout: true,
          renderSideBySide: false,
          useInlineViewWhenSpaceIsLimited: true,
          ignoreTrimWhitespace: true,
          renderOverviewRuler: true,
          overviewRulerBorder: false,
          renderMarginRevertIcon: false,
          renderGutterMenu: false,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
          padding: { top: 8, bottom: 8 },
          diffWordWrap: 'off',
          lineNumbers: 'on',
          folding: false,
          renderIndicators: true,
          diffAlgorithm: 'advanced',
          maxComputationTime: 1500,
          hideUnchangedRegions: {
            enabled: true,
            contextLineCount: 3,
            minimumLineCount: 5,
            revealLineCount: 20
          },
          experimental: {
            showMoves: false,
            showEmptyDecorations: false,
            useTrueInlineView: false
          }
        })
        editorRef.current = editor
        stopThemeWatch = watchCodeTheme()
        updateEditorReady(true)
      })

      return function () {
        cancelled = true
        updateEditorReady(false)
        stopThemeWatch?.()
        editor?.setModel(null)
        editor?.dispose()
        editorRef.current = null
        monacoRef.current = null
      }
    },
    []
  )

  useEffect(
    function () {
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (!editor || !monaco || !side || !isEditorReady) return
      editor.setModel(null)
      modelsRef.current.forEach(function (model) {
        model.dispose()
      })
      modelsRef.current = []
      if (side.isBinary || side.isIdentical || side.mode !== 'sideBySide') return

      const language = findLanguageId(relative)
      const original = createLanguageModel(
        monaco,
        side.original,
        language,
        findOriginalUri(relative, monaco)
      )
      const modified = createLanguageModel(monaco, side.modified, language)
      modelsRef.current = [original, modified]
      editor.updateOptions({
        diffAlgorithm: 'advanced',
        maxComputationTime: 1500,
        hideUnchangedRegions: {
          enabled: true,
          contextLineCount: 3,
          minimumLineCount: 5,
          revealLineCount: 20
        }
      })
      editor.setModel({ original, modified })
      requestAnimationFrame(function () {
        editor.layout()
      })
    },
    [side, relative, isEditorReady]
  )

  useEffect(
    function () {
      editorRef.current?.updateOptions({
        fontSize: editorPrefs.fontSize,
        lineHeight: findLineHeight(editorPrefs.fontSize, editorPrefs.lineHeightRatio),
        fontFamily: editorPrefs.fontFamily.trim() || undefined,
        fontLigatures: editorPrefs.isLigaturesEnabled
      })
    },
    [editorPrefs]
  )

  useEffect(
    function () {
      return function () {
        modelsRef.current.forEach(function (model) {
          model.dispose()
        })
        modelsRef.current = []
      }
    },
    []
  )

  const showSide = Boolean(side && side.mode === 'sideBySide' && !side.isBinary && !side.isIdentical)

  return { hostRef, showSide }
}

export { useAsideDiffEditor }
