/**
 * 右栏内联 Diff：HEAD ↔ 工作区（Monaco，窄栏强制并排收成 inline）。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'

import { CODE_THEME, applyCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import { WorkspaceGit, type DiffResult } from '@/lib/workspace-git'
import { findLanguageId } from '@/views/code/lib/language.ts'
import '@/lib/monaco-environment.ts'

interface AsideDiffProps {
  rootPath: string
  relative: string
  onBack: () => void
}

function findOriginalUri(relative: string): monaco.Uri {
  return monaco.Uri.parse(`inmemory://agent-aside-original/${encodeURIComponent(relative)}`)
}

function AsideDiff(props: AsideDiffProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<monaco.editor.ITextModel[]>([])
  const [diff, updateDiff] = useState<DiffResult | null>(null)
  const [error, updateError] = useState<string | null>(null)
  const [isPending, updatePending] = useState(true)

  useEffect(
    function () {
      let cancelled = false

      async function load() {
        try {
          updatePending(true)
          updateError(null)
          updateDiff(null)
          const result = await WorkspaceGit.diff(props.rootPath, props.relative)
          if (!cancelled) updateDiff(result)
        } catch (cause) {
          console.warn('[agent/aside-diff] 读取差异失败:', cause)
          if (!cancelled) {
            updateError(cause instanceof Error ? cause.message : '读取差异失败')
          }
        } finally {
          if (!cancelled) updatePending(false)
        }
      }

      void load()

      return function () {
        cancelled = true
      }
    },
    [props.rootPath, props.relative]
  )

  useEffect(
    function () {
      const host = hostRef.current
      if (!host) return

      applyCodeTheme()
      const editor = monaco.editor.createDiffEditor(host, {
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
        renderIndicators: true
      })
      editorRef.current = editor
      const stopThemeWatch = watchCodeTheme()

      return function () {
        stopThemeWatch()
        editor.setModel(null)
        editor.dispose()
        editorRef.current = null
      }
    },
    []
  )

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

      const language = findLanguageId(props.relative)
      const original = monaco.editor.createModel(
        diff.original,
        language,
        findOriginalUri(props.relative)
      )
      const modified = monaco.editor.createModel(diff.modified, language)
      modelsRef.current = [original, modified]
      editor.setModel({ original, modified })
    },
    [diff, props.relative]
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="返回变更列表"
          className="size-7"
          onClick={props.onBack}>
          <Icon
            icon="lucide:chevron-left"
            className="size-3.5"
          />
        </Button>
        <Icon
          icon="lucide:git-compare"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span
          className="text-foreground min-w-0 flex-1 truncate text-xs"
          title={props.relative}>
          {props.relative}
        </span>
        <span className="text-muted-foreground shrink-0 text-[10px]">HEAD ↔ 工作区</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className="size-full"
        />
        {isPending ? (
          <p className="bg-background text-muted-foreground absolute inset-0 flex items-center gap-1.5 p-3 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取差异…
          </p>
        ) : null}
        {error ? (
          <p className="bg-background text-destructive absolute inset-0 p-3 text-xs">{error}</p>
        ) : null}
        {!isPending && !error && diff?.isBinary ? (
          <p className="bg-background text-muted-foreground absolute inset-0 flex items-center justify-center p-3 text-xs">
            这是二进制文件，无法对比内容
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { AsideDiff }
