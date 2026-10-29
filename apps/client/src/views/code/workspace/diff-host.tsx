/**
 * Git 差异视图：并排对比 HEAD 与工作区内容。
 *
 * 覆盖在编辑器之上而不是替换它 —— 关掉差异时滚动位置、选区都还在。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'

import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { findLanguageId } from '@/views/code/lib/language.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'
// worker 装配只有一份，见 lib/monaco-environment.ts
import '@/lib/monaco-environment.ts'

function findOriginalUri(relative: string): monaco.Uri {
  return monaco.Uri.parse(`inmemory://git-original/${encodeURIComponent(relative)}`)
}

function DiffHost() {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<monaco.editor.ITextModel[]>([])
  const diff = useCodeGitStore(function (state) {
    return state.diff
  })
  const repoRoot = useCodeGitStore(function (state) {
    return state.repoRoot
  })
  const editorPrefs = useCodeStore(function (state) {
    return state.editorPrefs
  })

  useEffect(function () {
    const host = hostRef.current
    if (!host) return

    syncCodeTheme()
    const editor = monaco.editor.createDiffEditor(host, {
      theme: CODE_THEME,
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      ignoreTrimWhitespace: false,
      renderOverviewRuler: false,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      padding: { top: 8, bottom: 8 },
      diffWordWrap: 'off'
    })
    editorRef.current = editor
    const stopThemeWatch = watchCodeTheme()

    return function () {
      stopThemeWatch()
      editor.setModel(null)
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  // 差异内容变化时重建模型；先解绑再销毁，避免编辑器引用到已销毁的 model
  useEffect(
    function () {
      const editor = editorRef.current
      if (!editor || !diff) return
      editor.setModel(null)
      modelsRef.current.forEach(function (model) {
        model.dispose()
      })
      modelsRef.current = []
      if (diff.isBinary) return
      const language = findLanguageId(diff.relative)
      const original = monaco.editor.createModel(
        diff.original,
        language,
        findOriginalUri(diff.relative)
      )
      const modified = monaco.editor.createModel(diff.modified, language)
      modelsRef.current = [original, modified]
      editor.setModel({ original, modified })
    },
    [diff]
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
      editorRef.current?.updateOptions({
        fontSize: editorPrefs.fontSize,
        lineHeight: Math.max(editorPrefs.fontSize + 2, Math.round(editorPrefs.fontSize * editorPrefs.lineHeightRatio)),
        fontFamily: editorPrefs.fontFamily.trim() || undefined,
        fontLigatures: editorPrefs.isLigaturesEnabled
      })
    },
    [editorPrefs]
  )

  function onOpenInEditor() {
    if (!diff || !repoRoot) return
    const absolute = `${repoRoot.replace(/[\\/]+$/, '')}/${diff.relative}`
    useCodeGitStore.getState().toCloseDiff()
    void openAbsolutePath(absolute)
  }

  return (
    <div className="bg-background absolute inset-0 flex flex-col">
      <div className="border-border/50 flex h-7 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <Icon
          icon="lucide:git-compare"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span className="text-foreground truncate">{diff?.relative ?? ''}</span>
        <span className="text-muted-foreground shrink-0 text-[11px]">HEAD ↔ 工作区</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={onOpenInEditor}>
            打开文件
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={function () {
              useCodeGitStore.getState().toCloseDiff()
            }}>
            返回编辑
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className="size-full"
        />
        {diff?.isBinary ? (
          <div className="bg-background text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
            这是二进制文件，无法对比内容
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { DiffHost }
