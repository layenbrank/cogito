import type * as Monaco from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'

import { importMonaco } from '@/lib/monaco-loader.ts'
import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import type { DiffResult } from '@/lib/workspace-git'
import { findLanguageId } from '@/views/code/lib/language.ts'

type MonacoModule = typeof Monaco

function findOriginalUri(relative: string, monaco: MonacoModule): Monaco.Uri {
  return monaco.Uri.parse(`inmemory://agent-aside-original/${encodeURIComponent(relative)}`)
}

function useAsideDiffEditor(relative: string, side: DiffResult | null) {
  const hostRef = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<MonacoModule | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<Monaco.editor.ITextModel[]>([])
  const [isEditorReady, updateEditorReady] = useState(false)

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
        editor = monaco.editor.createDiffEditor(host, {
          theme: CODE_THEME,
          readOnly: true,
          originalEditable: false,
          automaticLayout: true,
          renderSideBySide: false,
          useInlineViewWhenSpaceIsLimited: true,
          ignoreTrimWhitespace: false,
          renderOverviewRuler: false,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
          padding: { top: 4, bottom: 4 },
          diffWordWrap: 'on',
          fontSize: 12,
          lineNumbers: 'off',
          folding: false,
          renderIndicators: true,
          maxComputationTime: 1500
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
      const original = monaco.editor.createModel(
        side.original,
        language,
        findOriginalUri(relative, monaco)
      )
      const modified = monaco.editor.createModel(side.modified, language)
      modelsRef.current = [original, modified]
      editor.setModel({ original, modified })
    },
    [side, relative, isEditorReady]
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
