import type * as Monaco from 'monaco-editor'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { importMonaco } from '@/lib/monaco-loader.ts'
import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { findLanguageId } from '@/views/code/lib/language.ts'
import '@/lib/monaco-environment.ts'

type MonacoModule = typeof Monaco

function findOriginalUri(relative: string, monaco: MonacoModule): Monaco.Uri {
  return monaco.Uri.parse(`inmemory://git-original/${encodeURIComponent(relative)}`)
}

function useDiffMonacoEditor(options: {
  sideHostRef: RefObject<HTMLDivElement | null>
  isOpen: boolean
  isSideBySide: boolean
}) {
  const monacoRef = useRef<MonacoModule | null>(null)
  const sideEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<Monaco.editor.ITextModel[]>([])
  const [isEditorReady, updateEditorReady] = useState(false)

  const diff = useCodeGitStore(function (state) {
    return state.diff
  })
  const editorPrefs = useCodeStore(function (state) {
    return state.editorPrefs
  })

  useEffect(function () {
    const sideHost = options.sideHostRef.current
    if (!sideHost) return

    let cancelled = false
    let sideEditor: Monaco.editor.IStandaloneDiffEditor | null = null
    let stopThemeWatch: (() => void) | null = null

    void importMonaco().then(function (monaco) {
      if (cancelled) return
      monacoRef.current = monaco
      syncCodeTheme()
      sideEditor = monaco.editor.createDiffEditor(sideHost, {
        theme: CODE_THEME,
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
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
      sideEditorRef.current = sideEditor
      stopThemeWatch = watchCodeTheme()
      updateEditorReady(true)
    })

    return function () {
      cancelled = true
      updateEditorReady(false)
      stopThemeWatch?.()
      sideEditor?.setModel(null)
      sideEditor?.dispose()
      sideEditorRef.current = null
      monacoRef.current = null
    }
  }, [options.sideHostRef])

  useEffect(
    function () {
      const sideEditor = sideEditorRef.current
      const monaco = monacoRef.current
      if (!sideEditor || !monaco || !isEditorReady) return

      sideEditor.setModel(null)
      modelsRef.current.forEach(function (model) {
        model.dispose()
      })
      modelsRef.current = []

      if (!diff || diff.isLoading || diff.isBinary || diff.isIdentical) return
      if (diff.mode !== 'sideBySide') return

      const language = findLanguageId(diff.relative)
      const original = monaco.editor.createModel(
        diff.original,
        language,
        findOriginalUri(diff.relative, monaco)
      )
      const modified = monaco.editor.createModel(diff.modified, language)
      modelsRef.current = [original, modified]
      sideEditor.updateOptions({
        diffAlgorithm: 'advanced',
        maxComputationTime: 1500,
        hideUnchangedRegions: {
          enabled: true,
          contextLineCount: 3,
          minimumLineCount: 5,
          revealLineCount: 20
        }
      })
      sideEditor.setModel({ original, modified })
      requestAnimationFrame(function () {
        sideEditor.layout()
      })
    },
    [diff, isEditorReady]
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

  useEffect(
    function () {
      const font = {
        fontSize: editorPrefs.fontSize,
        lineHeight: Math.max(
          editorPrefs.fontSize + 2,
          Math.round(editorPrefs.fontSize * editorPrefs.lineHeightRatio)
        ),
        fontFamily: editorPrefs.fontFamily.trim() || undefined,
        fontLigatures: editorPrefs.isLigaturesEnabled
      }
      sideEditorRef.current?.updateOptions(font)
    },
    [editorPrefs]
  )

  useEffect(
    function () {
      const sideEditor = sideEditorRef.current
      if (!options.isOpen || !sideEditor) return
      sideEditor.updateOptions({
        renderSideBySide: options.isSideBySide,
        useInlineViewWhenSpaceIsLimited: false
      })
      requestAnimationFrame(function () {
        sideEditor.layout()
      })
    },
    [options.isOpen, options.isSideBySide]
  )

  return { isEditorReady }
}

export { useDiffMonacoEditor }
