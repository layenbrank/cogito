/**
 * 右栏内联 Diff：HEAD ↔ 工作区。
 * 小文件 Monaco inline；大重写走 hunks 列表，禁止 DiffEditor LCS。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'

import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import {
  WorkspaceGit,
  type DiffHunk,
  type DiffMeta,
  type DiffResult
} from '@/lib/workspace-git'
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

const HUNK_PAGE = 40

function AsideHunks(props: {
  hunks: DiffHunk[]
  total: number
  added: number
  deleted: number
  isLoading: boolean
  hasMore: boolean
  onMore: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { hasMore, isLoading, onMore } = props

  useEffect(
    function () {
      const node = scrollRef.current
      if (!node) return
      function onScroll() {
        if (!node) return
        const remain = node.scrollHeight - node.scrollTop - node.clientHeight
        if (remain < 160 && hasMore && !isLoading) {
          onMore()
        }
      }
      node.addEventListener('scroll', onScroll, { passive: true })
      return function () {
        node.removeEventListener('scroll', onScroll)
      }
    },
    [hasMore, isLoading, onMore]
  )

  return (
    <div
      ref={scrollRef}
      className="size-full overflow-auto font-mono text-[11px] leading-[16px]">
      <div className="text-muted-foreground border-border sticky top-0 z-[1] border-b bg-background px-2 py-1 text-[10px]">
        +{props.added} / −{props.deleted} · {props.hunks.length}
        {props.total > 0 ? ` / ${props.total}` : ''} 块
      </div>
      {props.hunks.map(function (hunk, index) {
        return (
          <div
            key={`${hunk.header}@${index}`}
            className="border-border border-b">
            <div className="bg-muted/40 text-muted-foreground truncate px-2 py-0.5">
              {hunk.header}
            </div>
            {hunk.lines.map(function (line, lineIndex) {
              const kind = line.charAt(0)
              return (
                <div
                  key={`${index}-${lineIndex}`}
                  className={cn(
                    'px-2 whitespace-pre',
                    kind === '+' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                    kind === '-' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  )}>
                  {line}
                </div>
              )
            })}
          </div>
        )
      })}
      {props.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-1.5 p-2 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3 animate-spin"
          />
          加载中…
        </p>
      ) : null}
    </div>
  )
}

function AsideDiff(props: AsideDiffProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<monaco.editor.ITextModel[]>([])
  const [meta, updateMeta] = useState<DiffMeta | null>(null)
  const [side, updateSide] = useState<DiffResult | null>(null)
  const [hunks, updateHunks] = useState<DiffHunk[]>([])
  const [hunkTotal, updateHunkTotal] = useState(0)
  const [isHunksLoading, updateHunksLoading] = useState(false)
  const [error, updateError] = useState<string | null>(null)
  const [isPending, updatePending] = useState(true)

  useEffect(
    function () {
      let cancelled = false

      async function load() {
        try {
          updatePending(true)
          updateError(null)
          updateMeta(null)
          updateSide(null)
          updateHunks([])
          updateHunkTotal(0)
          const nextMeta = await WorkspaceGit.diffMeta(props.rootPath, props.relative)
          if (cancelled) return
          updateMeta(nextMeta)
          if (nextMeta.isBinary || nextMeta.isIdentical) {
            return
          }
          if (nextMeta.mode === 'hunks') {
            updateHunksLoading(true)
            const page = await WorkspaceGit.diffHunks(
              props.rootPath,
              props.relative,
              0,
              HUNK_PAGE
            )
            if (cancelled) return
            updateHunks(page.hunks)
            updateHunkTotal(page.total)
            updateHunksLoading(false)
            return
          }
          const result = await WorkspaceGit.diff(props.rootPath, props.relative)
          if (!cancelled) updateSide(result)
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

  async function onMoreHunks() {
    if (isHunksLoading || hunks.length >= hunkTotal) return
    updateHunksLoading(true)
    try {
      const page = await WorkspaceGit.diffHunks(
        props.rootPath,
        props.relative,
        hunks.length,
        HUNK_PAGE
      )
      updateHunks(function (prev) {
        return prev.concat(page.hunks)
      })
      updateHunkTotal(page.total)
    } catch (cause) {
      console.warn('[agent/aside-diff] 分页失败:', cause)
    } finally {
      updateHunksLoading(false)
    }
  }

  useEffect(
    function () {
      const host = hostRef.current
      if (!host) return

      syncCodeTheme()
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
        renderIndicators: true,
        maxComputationTime: 1500
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
      if (!editor || !side) return
      editor.setModel(null)
      modelsRef.current.forEach(function (model) {
        model.dispose()
      })
      modelsRef.current = []
      if (side.isBinary || side.isIdentical || side.mode !== 'sideBySide') return

      const language = findLanguageId(props.relative)
      const original = monaco.editor.createModel(
        side.original,
        language,
        findOriginalUri(props.relative)
      )
      const modified = monaco.editor.createModel(side.modified, language)
      modelsRef.current = [original, modified]
      editor.setModel({ original, modified })
    },
    [side, props.relative]
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

  const isHunks = meta?.mode === 'hunks'
  const showSide = Boolean(side && side.mode === 'sideBySide' && !side.isBinary && !side.isIdentical)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="返回变更列表"
          title="返回变更列表"
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
          className="text-foreground min-w-0 flex-1 truncate text-xs font-medium"
          title={props.relative}>
          {props.relative.includes('/')
            ? props.relative.slice(props.relative.lastIndexOf('/') + 1)
            : props.relative}
        </span>
        <span
          className="text-muted-foreground hidden max-w-[42%] truncate text-[10px] sm:inline"
          title={props.relative}>
          {props.relative.includes('/')
            ? props.relative.slice(0, props.relative.lastIndexOf('/'))
            : '工作区'}
        </span>
        <span className="text-muted-foreground shrink-0 text-[10px]">
          {isHunks ? 'hunks' : 'HEAD ↔ 工作区'}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={hostRef}
          className={cn('size-full', (!showSide || isPending) && 'hidden')}
        />
        {isHunks && !isPending && !meta?.isBinary ? (
          <AsideHunks
            hunks={hunks}
            total={hunkTotal}
            added={meta?.added ?? 0}
            deleted={meta?.deleted ?? 0}
            isLoading={isHunksLoading}
            hasMore={hunks.length < hunkTotal}
            onMore={function () {
              void onMoreHunks()
            }}
          />
        ) : null}
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
        {!isPending && !error && meta?.isBinary ? (
          <p className="bg-background text-muted-foreground absolute inset-0 flex items-center justify-center p-3 text-xs">
            这是二进制文件，无法对比内容
          </p>
        ) : null}
        {!isPending && !error && meta?.isIdentical ? (
          <p className="bg-background text-muted-foreground absolute inset-0 flex items-center justify-center p-3 text-xs">
            归一换行后内容相同
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { AsideDiff }
