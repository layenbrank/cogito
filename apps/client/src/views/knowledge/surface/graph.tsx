/**
 * 图谱页：wikilink 图 + 交互画布（点选、缩放、平移）。
 */
import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import { openEditorPath } from '@/views/knowledge/workspace/editor-context.ts'
import {
  buildWikiGraph,
  clusterLouvain,
  findGraphInsights,
  type WikiGraph
} from '@/views/knowledge/lib/wiki-graph.ts'
import type { WikiPage } from '@/views/knowledge/lib/wiki-lint.ts'
import { enqueueResearchTopic } from '@/views/knowledge/surface/research.tsx'
import {
  ToolEmpty,
  ToolListCard,
  ToolPageHeader,
  ToolStatPill
} from '@/views/knowledge/surface/tool-surface.tsx'

interface LayoutNode {
  id: string
  title: string
  relative: string
  x: number
  y: number
  degree: number
  community: number
}

const COMMUNITY_COLORS = [
  'var(--chart-1, oklch(0.65 0.15 250))',
  'var(--chart-2, oklch(0.65 0.12 160))',
  'var(--chart-3, oklch(0.68 0.14 40))',
  'var(--chart-4, oklch(0.62 0.14 300))',
  'var(--chart-5, oklch(0.7 0.1 90))'
]

function layoutNodes(
  graph: WikiGraph,
  communities: Map<string, number>,
  width: number,
  height: number
): LayoutNode[] {
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.36
  const n = Math.max(graph.nodes.length, 1)
  return graph.nodes.map(function (node, index) {
    const angle = (Math.PI * 2 * index) / n - Math.PI / 2
    const ring = 0.85 + (node.degree % 4) * 0.05
    return {
      id: node.id,
      title: node.title,
      relative: node.relative,
      x: cx + Math.cos(angle) * radius * ring,
      y: cy + Math.sin(angle) * radius * ring,
      degree: node.degree,
      community: communities.get(node.id) ?? 0
    }
  })
}

function GraphCanvas(props: {
  graph: WikiGraph
  communities: Map<string, number>
  onOpen: (relative: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 640, height: 420 })
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const dragRef = useRef<{
    mode: 'pan' | null
    moved: boolean
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  useEffect(
    function () {
      const element = containerRef.current
      if (!element) return
      function measure() {
        if (!element) return
        setSize({
          width: Math.max(320, element.clientWidth),
          height: Math.max(280, element.clientHeight)
        })
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      return function () {
        observer.disconnect()
      }
    },
    []
  )

  const nodes = useMemo(
    function () {
      return layoutNodes(props.graph, props.communities, size.width, size.height)
    },
    [props.graph, props.communities, size.height, size.width]
  )

  const byId = useMemo(
    function () {
      const map = new Map<string, LayoutNode>()
      for (const node of nodes) map.set(node.id, node)
      return map
    },
    [nodes]
  )

  return (
    <div
      ref={containerRef}
      className="bg-muted/20 relative min-h-[280px] w-full flex-1 overflow-hidden rounded-xl border border-border/70"
      onWheel={function (event) {
        event.preventDefault()
        const next = Math.min(2.5, Math.max(0.4, scale + (event.deltaY > 0 ? -0.08 : 0.08)))
        setScale(next)
      }}
      onPointerDown={function (event) {
        if (event.button !== 0) return
        dragRef.current = {
          mode: 'pan',
          moved: false,
          startX: event.clientX,
          startY: event.clientY,
          originX: pan.x,
          originY: pan.y
        }
        ;(event.currentTarget).setPointerCapture(event.pointerId)
      }}
      onPointerMove={function (event) {
        const drag = dragRef.current
        if (!drag || drag.mode !== 'pan') return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
        setPan({
          x: drag.originX + dx,
          y: drag.originY + dy
        })
      }}
      onPointerUp={function () {
        dragRef.current = null
      }}>
      <svg
        width={size.width}
        height={size.height}
        className="touch-none select-none">
        <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
          {props.graph.edges.map(function (edge) {
            const from = byId.get(edge.from)
            const to = byId.get(edge.to)
            if (!from || !to) return null
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="currentColor"
                className="text-border"
                strokeWidth={1.25}
                opacity={0.7}
              />
            )
          })}
          {nodes.map(function (node) {
            const fill = COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]
            const isHover = hoverId === node.id
            return (
              <g
                key={node.id}
                transform={`translate(${node.x} ${node.y})`}
                className="cursor-pointer"
                onPointerEnter={function () {
                  setHoverId(node.id)
                }}
                onPointerLeave={function () {
                  setHoverId(null)
                }}
                onClick={function (event) {
                  event.stopPropagation()
                  if (dragRef.current?.moved) return
                  if (!node.relative) return
                  props.onOpen(node.relative)
                }}>
                <circle
                  r={(isHover ? 8 : 6) + Math.min(8, node.degree)}
                  fill={fill}
                  stroke="var(--background)"
                  strokeWidth={2}
                  opacity={isHover ? 1 : 0.92}
                />
                <title>{node.title}</title>
                <text
                  y={18 + Math.min(8, node.degree)}
                  textAnchor="middle"
                  className="fill-foreground text-[10px] font-medium"
                  opacity={isHover ? 1 : 0.85}>
                  {node.title.slice(0, 14)}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="text-muted-foreground pointer-events-none absolute right-2.5 bottom-2.5 rounded-md bg-background/80 px-2.5 py-1 text-xs backdrop-blur-sm">
        滚轮缩放 · 拖拽平移 · 点击预览
      </div>
    </div>
  )
}

function GraphTab() {
  const docs = useKnowledgeBaseStore(function (state) {
    return state.docs
  })
  const bases = useKnowledgeBaseStore(function (state) {
    return state.bases
  })
  const activeBaseID = useKnowledgeBaseStore(function (state) {
    return state.activeBaseID
  })
  const [graph, setGraph] = useState<WikiGraph | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    relative: string
    title: string
    snippet: string
  } | null>(null)

  const communities = useMemo(
    function () {
      return graph ? clusterLouvain(graph) : null
    },
    [graph]
  )

  const insights = useMemo(
    function () {
      if (!graph || !communities) return []
      return findGraphInsights(graph, communities)
    },
    [graph, communities]
  )

  async function rebuild() {
    const base = bases.find(function (item) {
      return item.id === activeBaseID
    })
    if (!base?.rootPath) {
      setError('无活动知识库')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const pages: WikiPage[] = []
      for (const doc of docs) {
        if (!/\.md$/i.test(doc.relPath)) continue
        try {
          const content = await readTextFile(joinPath(base.rootPath, doc.relPath))
          pages.push({
            relative: doc.relPath,
            title: doc.title,
            content
          })
        } catch (readError) {
          console.warn('[graph] skip unreadable', doc.relPath, readError)
        }
      }
      setGraph(buildWikiGraph(pages))
    } catch (rebuildError) {
      const message =
        rebuildError instanceof Error ? rebuildError.message : String(rebuildError)
      console.error('[graph] rebuild failed', rebuildError)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function selectNode(relative: string) {
    const node = graph?.nodes.find(function (item) {
      return item.relative === relative
    })
    const doc = docs.find(function (item) {
      return item.relPath === relative
    })
    setPreview({
      relative,
      title: node?.title ?? doc?.title ?? relative,
      snippet: doc ? `${doc.relPath} · ${doc.wordCount} 字` : relative
    })
  }

  function openPreviewInWiki() {
    if (!preview) return
    const base = bases.find(function (item) {
      return item.id === activeBaseID
    })
    if (!base?.rootPath) return
    openEditorPath(joinPath(base.rootPath, preview.relative))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ToolPageHeader
        title="图谱"
        description="基于 wikilink 与标题信号构建关系图，支持社区着色。"
        meta={
          graph ? (
            <>
              <ToolStatPill
                label="节点"
                value={graph.nodes.length}
                tone="accent"
              />
              <ToolStatPill
                label="边"
                value={graph.edges.length}
              />
              <ToolStatPill
                label="洞察"
                value={insights.length}
              />
            </>
          ) : undefined
        }
        actions={
          <Button
            size="sm"
            className="h-8"
            disabled={busy}
            onClick={function () {
              void rebuild()
            }}>
            {busy ? '重建中…' : graph ? '重新扫描' : '重建图谱'}
          </Button>
        }
      />
      {error ? <p className="text-destructive mb-2 text-xs">{error}</p> : null}

      {!graph || !communities ? (
        <ToolEmpty
          icon="lucide:git-fork"
          title="尚未构建图谱"
          description="扫描 wiki 正文中的 [[wikilink]]，生成可交互关系图。"
          action={
            <Button
              size="sm"
              disabled={busy}
              onClick={function () {
                void rebuild()
              }}>
              {busy ? '重建中…' : '开始重建'}
            </Button>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
          <GraphCanvas
            graph={graph}
            communities={communities}
            onOpen={selectNode}
          />
          <ScrollArea className="lg:w-72 lg:shrink-0">
            <div className="flex flex-col gap-2 lg:pr-1">
              {preview ? (
                <div className="rounded-md border border-border/80 bg-card/60 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                      预览
                    </p>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground text-xs outline-none"
                      onClick={function () {
                        setPreview(null)
                      }}>
                      关闭
                    </button>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium">{preview.title}</p>
                  <p className="text-muted-foreground mt-1 truncate text-xs">{preview.snippet}</p>
                  <Button
                    size="sm"
                    className="mt-2 h-7 w-full text-xs"
                    onClick={openPreviewInWiki}>
                    在 Wiki 打开
                  </Button>
                </div>
              ) : null}
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Insights
              </p>
              {insights.length === 0 ? (
                <p className="text-muted-foreground text-xs">暂无洞察</p>
              ) : (
                insights.map(function (insight, index) {
                  return (
                    <ToolListCard key={`${insight.kind}-${index}`}>
                      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {insight.kind}
                      </p>
                      <p className="mt-1 text-sm leading-6">{insight.detail}</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 px-2.5 text-xs"
                        onClick={function () {
                          enqueueResearchTopic(insight.detail.slice(0, 80))
                        }}>
                        一键 Research
                      </Button>
                    </ToolListCard>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

export { GraphTab }
