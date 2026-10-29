/**
 * Git 差异视图。
 *
 * 小改动：Monaco DiffEditor（宽屏并排 / 窄屏 inline，对齐 VS Code 900px 断点）。
 * 大重写：结构化 hunk 列表；宽屏双列、窄屏统一视图。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { CODE_THEME, syncCodeTheme, watchCodeTheme } from '@/lib/monaco-theme.ts'
import type { DiffHunk } from '@/lib/workspace-git'
import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { requestCloseTabs } from '@/views/code/lib/close-tabs.ts'
import { findLanguageId } from '@/views/code/lib/language.ts'
import '@/lib/monaco-environment.ts'

/** 与 VS Code `diffEditor.renderSideBySideInlineBreakpoint` 默认一致；带滞回避免临界抖动 */
const SIDE_BY_SIDE_BREAKPOINT = 900
const SIDE_BY_SIDE_ENTER = 920
const SIDE_BY_SIDE_EXIT = 880

type DiffLayout = 'sideBySide' | 'inline'

interface SideRow {
  left: string | null
  right: string | null
  tag: 'ctx' | 'del' | 'add' | 'mod'
}

function findOriginalUri(relative: string): monaco.Uri {
  return monaco.Uri.parse(`inmemory://git-original/${encodeURIComponent(relative)}`)
}

/**
 * 将 unified hunk 行对齐成并排行（连续删改配对）。
 */
function toSideRows(lines: string[]): SideRow[] {
  const rows: SideRow[] = []
  let index = 0
  while (index < lines.length) {
    const kind = lines[index]?.charAt(0)
    if (kind === ' ') {
      const body = lines[index].slice(1)
      rows.push({ left: body, right: body, tag: 'ctx' })
      index += 1
      continue
    }
    if (kind === '-') {
      const deleted: string[] = []
      while (index < lines.length && lines[index].charAt(0) === '-') {
        deleted.push(lines[index].slice(1))
        index += 1
      }
      const added: string[] = []
      while (index < lines.length && lines[index].charAt(0) === '+') {
        added.push(lines[index].slice(1))
        index += 1
      }
      const count = Math.max(deleted.length, added.length)
      for (let offset = 0; offset < count; offset += 1) {
        const left = deleted[offset] ?? null
        const right = added[offset] ?? null
        const tag =
          left !== null && right !== null ? 'mod' : left !== null ? 'del' : 'add'
        rows.push({ left, right, tag })
      }
      continue
    }
    if (kind === '+') {
      rows.push({ left: null, right: lines[index].slice(1), tag: 'add' })
      index += 1
      continue
    }
    index += 1
  }
  return rows
}

/**
 * 观测内容区宽度，驱动单列/并排。
 * 忽略 width≤0（节点 hidden 时），避免打开差异后卡在 inline。
 */
function useContainerLayout(isActive: boolean): {
  hostRef: RefObject<HTMLDivElement | null>
  layout: DiffLayout
} {
  const hostRef = useRef<HTMLDivElement>(null)
  const [layout, updateLayout] = useState<DiffLayout>('sideBySide')
  const layoutRef = useRef<DiffLayout>('sideBySide')

  useEffect(
    function () {
      const node = hostRef.current
      if (!node || typeof ResizeObserver === 'undefined') return

      function syncWidth(width: number) {
        if (!isActive || width < 1) return
        const current = layoutRef.current
        const next: DiffLayout =
          current === 'sideBySide'
            ? width < SIDE_BY_SIDE_EXIT
              ? 'inline'
              : 'sideBySide'
            : width >= SIDE_BY_SIDE_ENTER
              ? 'sideBySide'
              : 'inline'
        if (layoutRef.current === next) return
        layoutRef.current = next
        updateLayout(next)
      }

      const observer = new ResizeObserver(function (entries) {
        const entry = entries[0]
        if (!entry) return
        const width = entry.contentRect.width || node.clientWidth
        syncWidth(width)
      })
      observer.observe(node)

      if (isActive) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            syncWidth(node.clientWidth)
          })
        })
      }

      return function () {
        observer.disconnect()
      }
    },
    [isActive]
  )

  return { hostRef, layout }
}

function HunkBlock(props: {
  hunk: DiffHunk
  isCollapsed: boolean
  isSideBySide: boolean
  onToggle: () => void
}) {
  const { hunk, isCollapsed, isSideBySide, onToggle } = props
  const sideRows = isSideBySide ? toSideRows(hunk.lines) : null

  return (
    <div className="border-border border-b font-mono text-[12px] leading-[18px]">
      <button
        type="button"
        className="bg-muted/40 text-muted-foreground hover:bg-muted/70 flex w-full items-center gap-2 px-3 py-1 text-left"
        onClick={onToggle}>
        <Icon
          icon={isCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'}
          className="size-3 shrink-0"
        />
        <span className="truncate">{hunk.header}</span>
        <span className="text-muted-foreground/70 ml-auto shrink-0 tabular-nums">
          {hunk.lines.length} 行
        </span>
      </button>
      {isCollapsed ? null : isSideBySide && sideRows ? (
        <div className="grid grid-cols-2 divide-x divide-border">
          <div className="min-w-0 overflow-x-auto">
            {sideRows.map(function (row, index) {
              return (
                <div
                  key={`l-${index}`}
                  className={cn(
                    'px-3 whitespace-pre',
                    (row.tag === 'del' || row.tag === 'mod') &&
                      'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                    row.left === null && 'bg-muted/20 text-transparent'
                  )}>
                  {row.left ?? '\u00a0'}
                </div>
              )
            })}
          </div>
          <div className="min-w-0 overflow-x-auto">
            {sideRows.map(function (row, index) {
              return (
                <div
                  key={`r-${index}`}
                  className={cn(
                    'px-3 whitespace-pre',
                    (row.tag === 'add' || row.tag === 'mod') &&
                      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                    row.right === null && 'bg-muted/20 text-transparent'
                  )}>
                  {row.right ?? '\u00a0'}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <pre className="overflow-x-auto px-0 py-0 whitespace-pre">
          {hunk.lines.map(function (line, index) {
            const kind = line.charAt(0)
            const body = line.slice(1)
            return (
              <div
                key={`${hunk.header}-${index}`}
                className={cn(
                  'px-3',
                  kind === '+' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  kind === '-' && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                  kind === ' ' && 'text-foreground/80'
                )}>
                <span className="text-muted-foreground/50 mr-2 inline-block w-3 select-none">
                  {kind === ' ' ? '\u00a0' : kind}
                </span>
                {body}
              </div>
            )
          })}
        </pre>
      )}
    </div>
  )
}

function HunksView(props: { layout: DiffLayout }) {
  const diff = useCodeGitStore(function (state) {
    return state.diff
  })
  const relative = diff?.relative
  const [collapsed, updateCollapsed] = useState<Record<string, boolean>>({})
  const [collapsedRelative, setCollapsedRelative] = useState(relative)
  if (relative !== collapsedRelative) {
    setCollapsedRelative(relative)
    updateCollapsed({})
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const isSideBySide = props.layout === 'sideBySide'

  useEffect(
    function () {
      const node = scrollRef.current
      if (!node || !diff || diff.mode !== 'hunks') return

      function onScroll() {
        if (!node || !diff) return
        const remain = node.scrollHeight - node.scrollTop - node.clientHeight
        if (remain < 240 && diff.hasMoreHunks && !diff.isHunksLoading) {
          void useCodeGitStore.getState().toLoadMoreHunks()
        }
      }

      node.addEventListener('scroll', onScroll, { passive: true })
      return function () {
        node.removeEventListener('scroll', onScroll)
      }
    },
    [diff]
  )

  if (!diff || diff.mode !== 'hunks') return null

  return (
    <div
      ref={scrollRef}
      className="size-full overflow-auto">
      <div className="text-muted-foreground border-border flex items-center gap-3 border-b px-3 py-1.5 text-[11px]">
        <span>
          +{diff.added} / −{diff.deleted}
        </span>
        <span>
          已加载 {diff.hunks.length}
          {diff.hunkTotal > 0 ? ` / ${diff.hunkTotal}` : ''} 块
        </span>
        <span className="ml-auto">{isSideBySide ? '并排' : '单列'}</span>
      </div>
      {diff.hunks.map(function (hunk, index) {
        const key = `${hunk.header}@${index}`
        const isCollapsed = Boolean(collapsed[key])
        return (
          <HunkBlock
            key={key}
            hunk={hunk}
            isCollapsed={isCollapsed}
            isSideBySide={isSideBySide}
            onToggle={function () {
              updateCollapsed(function (prev) {
                return { ...prev, [key]: !prev[key] }
              })
            }}
          />
        )
      })}
      {diff.isHunksLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-4 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          加载更多变更块…
        </div>
      ) : null}
      {!diff.isHunksLoading && diff.hunks.length === 0 ? (
        <div className="text-muted-foreground flex items-center justify-center py-8 text-xs">
          没有可展示的变更块
        </div>
      ) : null}
    </div>
  )
}

function DiffHost(props: { isOpen: boolean }) {
  const sideHostRef = useRef<HTMLDivElement>(null)
  const sideEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<monaco.editor.ITextModel[]>([])
  const { hostRef: contentRef, layout } = useContainerLayout(props.isOpen)
  const isSideBySide = layout === 'sideBySide'
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
    const sideHost = sideHostRef.current
    if (!sideHost) return

    syncCodeTheme()
    // 关闭 Monaco 内置断点：由外层 ResizeObserver 显式切换，避免与 automaticLayout 抢状态
    const sideEditor = monaco.editor.createDiffEditor(sideHost, {
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
    const stopThemeWatch = watchCodeTheme()

    return function () {
      stopThemeWatch()
      sideEditor.setModel(null)
      sideEditor.dispose()
      sideEditorRef.current = null
    }
  }, [])

  useEffect(
    function () {
      const sideEditor = sideEditorRef.current
      if (!sideEditor) return

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
        findOriginalUri(diff.relative)
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
      // 布局由下方 isSideBySide effect 统一驱动，避免切换列数时重建 model
      requestAnimationFrame(function () {
        sideEditor.layout()
      })
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

  // 宽度变化 → 立即切换 Monaco 并排/inline（不依赖其内部断点）
  useEffect(
    function () {
      const sideEditor = sideEditorRef.current
      if (!props.isOpen || !sideEditor) return
      sideEditor.updateOptions({
        renderSideBySide: isSideBySide,
        useInlineViewWhenSpaceIsLimited: false
      })
      requestAnimationFrame(function () {
        sideEditor.layout()
      })
    },
    [props.isOpen, isSideBySide]
  )

  function onOpenInEditor() {
    if (!diff || !repoRoot) return
    const absolute = `${repoRoot.replace(/[\\/]+$/, '')}/${diff.relative}`
    // 打开/激活编辑标签，差异标签保留在标签栏（与 VS Code 并存）
    useCodeStore.getState().toOpenTab({ path: absolute })
  }

  function onCloseDiffTab() {
    const active = useCodeStore.getState().tabs.find(function (tab) {
      return tab.id === useCodeStore.getState().activeTabId
    })
    if (active?.kind === 'diff') {
      requestCloseTabs([active.id])
      return
    }
    useCodeGitStore.getState().toCloseDiff()
  }

  const isLoading = Boolean(diff?.isLoading)
  const isHunks = diff?.mode === 'hunks'
  const title = diff?.relative ?? ''
  const layoutHint = layout === 'sideBySide' ? '并排' : '单列'
  const revHint = diff?.newOid
    ? `${(diff.oldOid || '∅').slice(0, 7)} ↔ ${diff.newOid.slice(0, 7)}`
    : 'HEAD ↔ 工作区'
  const modeHint = diff?.isIdentical
    ? '内容相同（仅换行差异已忽略）'
    : isHunks
      ? `大改动 · hunks · ${layoutHint}`
      : `${revHint} · ${layoutHint}`

  return (
    <div
      className={cn(
        'bg-background absolute inset-0 z-10 flex flex-col',
        !props.isOpen && 'hidden'
      )}
      aria-hidden={!props.isOpen}>
      <div className="border-border bg-background flex h-7 shrink-0 items-center gap-2 border-b px-2 text-xs">
        <Icon
          icon="lucide:git-compare"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span className="text-foreground truncate">{title}</span>
        <span className="text-muted-foreground shrink-0 text-[11px]">{modeHint}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            disabled={!diff || isLoading}
            onClick={onOpenInEditor}>
            打开文件
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={onCloseDiffTab}>
            关闭
          </Button>
        </div>
      </div>
      {/* 宽度观测挂在内容区：与 Monaco/hunks 同宽，不受顶栏影响 */}
      <div
        ref={contentRef}
        className="relative isolate min-h-0 flex-1 overflow-hidden">
        <div
          ref={sideHostRef}
          className={cn(
            'size-full',
            (isHunks || isLoading || diff?.isBinary || diff?.isIdentical) && 'hidden'
          )}
        />
        {isHunks && !isLoading && !diff?.isBinary ? <HunksView layout={layout} /> : null}
        {isLoading ? (
          <div className="bg-background/80 text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-xs backdrop-blur-[1px]">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            正在读取差异…
          </div>
        ) : null}
        {diff?.isBinary ? (
          <div className="bg-background text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
            这是二进制文件，无法对比内容
          </div>
        ) : null}
        {diff && !diff.isLoading && diff.isIdentical ? (
          <div className="bg-background/80 text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
            归一换行后内容相同，没有可展示的差异
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { DiffHost }
