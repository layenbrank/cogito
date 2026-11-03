/**
 * 图谱页：wikilink 图 + 最小交互画布（点选打开页、滚轮缩放、拖动画布）。
 */
import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { joinPath } from '@/views/knowledge/lib/path.ts'
import { openPath } from '@/views/knowledge/lib/session.ts'
import {
  buildWikiGraph,
  clusterLouvain,
  findGraphInsights,
  type WikiGraph
} from '@/views/knowledge/lib/wiki-graph.ts'
import type { WikiPage } from '@/views/knowledge/lib/wiki-lint.ts'
import { enqueueResearchTopic } from '@/views/knowledge/surface/research.tsx'

interface LayoutNode {
  id: string
  title: string
  relative: string
  x: number
  y: number
  degree: number
  community: number
}

function layoutNodes(
  graph: WikiGraph,
  communities: Map<string, number>,
  width: number,
  height: number
): LayoutNode[] {
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.38
  const n = Math.max(graph.nodes.length, 1)
  return graph.nodes.map(function (node, index) {
    const angle = (Math.PI * 2 * index) / n - Math.PI / 2
    const jitter = (node.degree % 5) * 4
    return {
      id: node.id,
      title: node.title,
      relative: node.relative,
      x: cx + Math.cos(angle) * (radius + jitter),
      y: cy + Math.sin(angle) * (radius + jitter),
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
  const [size, setSize] = useState({ width: 640, height: 360 })
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{
    mode: 'pan' | null
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
          height: Math.max(240, element.clientHeight)
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
      className="bg-muted/20 relative h-64 min-h-[240px] w-full overflow-hidden rounded-md border border-border"
      onWheel={function (event) {
        event.preventDefault()
        const next = Math.min(2.5, Math.max(0.4, scale + (event.deltaY > 0 ? -0.08 : 0.08)))
        setScale(next)
      }}
      onPointerDown={function (event) {
        if (event.button !== 0) return
        dragRef.current = {
          mode: 'pan',
          startX: event.clientX,
          startY: event.clientY,
          originX: pan.x,
          originY: pan.y
        }
        ;(event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId)
      }}
      onPointerMove={function (event) {
        const drag = dragRef.current
        if (!drag || drag.mode !== 'pan') return
        setPan({
          x: drag.originX + (event.clientX - drag.startX),
          y: drag.originY + (event.clientY - drag.startY)
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
                strokeWidth={1}
              />
            )
          })}
          {nodes.map(function (node) {
            const hue = (node.community * 47) % 360
            return (
              <g
                key={node.id}
                transform={`translate(${node.x} ${node.y})`}
                className="cursor-pointer"
                onClick={function (event) {
                  event.stopPropagation()
                  if (!node.relative) return
                  props.onOpen(node.relative)
                }}>
                <circle
                  r={6 + Math.min(8, node.degree)}
                  fill={`hsl(${hue} 45% 52%)`}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
                <title>{node.title}</title>
                <text
                  y={18 + Math.min(8, node.degree)}
                  textAnchor="middle"
                  className="fill-foreground text-[10px]">
                  {node.title.slice(0, 16)}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="text-muted-foreground pointer-events-none absolute right-2 bottom-2 text-[10px]">
        滚轮缩放 · 拖拽平移 · 点击打开
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

  async function openNode(relative: string) {
    const base = bases.find(function (item) {
      return item.id === activeBaseID
    })
    if (!base?.rootPath) return
    try {
      await openPath(joinPath(base.rootPath, relative))
    } catch (error) {
      console.error('[graph] open failed', relative, error)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={function () {
            void rebuild()
          }}>
          {busy ? '重建中…' : '重建图谱'}
        </Button>
        <span className="text-muted-foreground text-[11px]">
          wikilink + 标题/路径信号 · Louvain · 交互画布
        </span>
      </div>
      {error ? <p className="text-destructive px-1 text-xs">{error}</p> : null}
      {graph && communities ? (
        <GraphCanvas
          graph={graph}
          communities={communities}
          onOpen={function (relative) {
            void openNode(relative)
          }}
        />
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        {!graph ? (
          <p className="text-muted-foreground px-1 py-2 text-xs">点「重建图谱」扫描 wiki 正文</p>
        ) : (
          <div className="flex flex-col gap-3">
            {insights.length > 0 ? (
              <section>
                <p className="text-muted-foreground mb-1 px-1 text-[11px] font-medium">
                  Insights {insights.length}
                </p>
                <ul className="flex flex-col gap-1">
                  {insights.map(function (insight, index) {
                    return (
                      <li
                        key={`${insight.kind}-${index}`}
                        className="rounded-md border border-border px-2 py-1 text-xs">
                        <p>
                          <span className="text-muted-foreground">[{insight.kind}] </span>
                          {insight.detail}
                        </p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-6 px-1.5 text-[11px]"
                          onClick={function () {
                            enqueueResearchTopic(insight.detail.slice(0, 80))
                          }}>
                          一键 Research
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : null}
            <section>
              <p className="text-muted-foreground mb-1 px-1 text-[11px] font-medium">
                节点 {graph.nodes.length} · 边 {graph.edges.length}
              </p>
            </section>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

export { GraphTab }
