/**
 * Wiki 关联图：wikilink 边 + 共现/标题相似/路径邻近等简易信号，Louvain 社区。
 */
import { parseWikilinks, type WikiPage } from '@/views/knowledge/lib/wiki-lint.ts'

interface GraphNode {
  id: string
  title: string
  relative: string
  degree: number
}

interface GraphEdge {
  from: string
  to: string
  weight: number
  signals: string[]
}

interface WikiGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

interface GraphInsight {
  kind: 'surprise' | 'gap'
  detail: string
  nodes: string[]
}

function pageId(page: WikiPage): string {
  return page.title.trim().toLowerCase() || page.relative.replace(/\\/g, '/').toLowerCase()
}

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[\s\-_/·.]+/)
      .filter(function (token) {
        return token.length >= 2
      })
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const token of a) {
    if (b.has(token)) inter += 1
  }
  return inter / (a.size + b.size - inter)
}

function pathAffinity(left: string, right: string): number {
  const a = left.replace(/\\/g, '/').split('/')
  const b = right.replace(/\\/g, '/').split('/')
  let shared = 0
  const limit = Math.min(a.length, b.length) - 1
  for (let i = 0; i < limit; i += 1) {
    if (a[i] === b[i]) shared += 1
    else break
  }
  return shared > 0 ? shared / Math.max(a.length, b.length) : 0
}

function upsertEdge(
  edgeMap: Map<string, GraphEdge>,
  from: string,
  to: string,
  weight: number,
  signal: string
): void {
  if (from === to) return
  const key = from < to ? `${from}|${to}` : `${to}|${from}`
  const [left, right] = from < to ? [from, to] : [to, from]
  const existing = edgeMap.get(key)
  if (existing) {
    existing.weight += weight
    if (!existing.signals.includes(signal)) existing.signals.push(signal)
    return
  }
  edgeMap.set(key, { from: left, to: right, weight, signals: [signal] })
}

function buildWikiGraph(pages: WikiPage[]): WikiGraph {
  const nodes = new Map<string, GraphNode>()
  const edgeMap = new Map<string, GraphEdge>()
  const tokens = new Map<string, Set<string>>()

  for (const page of pages) {
    const id = pageId(page)
    nodes.set(id, {
      id,
      title: page.title || page.relative,
      relative: page.relative,
      degree: 0
    })
    tokens.set(id, titleTokens(page.title || page.relative))
  }

  for (const page of pages) {
    const from = pageId(page)
    for (const link of parseWikilinks(page.content)) {
      const to = link.toLowerCase()
      if (!nodes.has(to)) {
        nodes.set(to, { id: to, title: link, relative: '', degree: 0 })
        tokens.set(to, titleTokens(link))
      }
      upsertEdge(edgeMap, from, to, 3, 'wikilink')
    }
  }

  const ids = [...nodes.keys()]
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const left = ids[i]
      const right = ids[j]
      const leftNode = nodes.get(left)
      const rightNode = nodes.get(right)
      if (!leftNode || !rightNode) continue

      const sim = jaccard(tokens.get(left) ?? new Set(), tokens.get(right) ?? new Set())
      if (sim >= 0.34) upsertEdge(edgeMap, left, right, sim, 'title')

      if (leftNode.relative && rightNode.relative) {
        const affinity = pathAffinity(leftNode.relative, rightNode.relative)
        if (affinity >= 0.25) upsertEdge(edgeMap, left, right, affinity, 'path')
      }
    }
  }

  for (const edge of edgeMap.values()) {
    const left = nodes.get(edge.from)
    const right = nodes.get(edge.to)
    if (left) left.degree += 1
    if (right) right.degree += 1
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edgeMap.values()]
  }
}

/** 简化 Louvain：迭代把节点并入邻居中增益最大的社区 */
function clusterLouvain(graph: WikiGraph, passes = 8): Map<string, number> {
  const communities = new Map<string, number>()
  graph.nodes.forEach(function (node, index) {
    communities.set(node.id, index)
  })

  const neighbors = new Map<string, { id: string; weight: number }[]>()
  for (const node of graph.nodes) neighbors.set(node.id, [])
  for (const edge of graph.edges) {
    neighbors.get(edge.from)?.push({ id: edge.to, weight: edge.weight })
    neighbors.get(edge.to)?.push({ id: edge.from, weight: edge.weight })
  }

  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false
    for (const node of graph.nodes) {
      const scores = new Map<string, number>()
      for (const neighbor of neighbors.get(node.id) ?? []) {
        const community = String(communities.get(neighbor.id) ?? -1)
        scores.set(community, (scores.get(community) ?? 0) + neighbor.weight)
      }
      let bestCommunity = communities.get(node.id) ?? 0
      let bestScore = -1
      for (const [community, score] of scores) {
        if (score > bestScore) {
          bestScore = score
          bestCommunity = Number(community)
        }
      }
      if (bestCommunity !== communities.get(node.id)) {
        communities.set(node.id, bestCommunity)
        moved = true
      }
    }
    if (!moved) break
  }

  const remap = new Map<number, number>()
  let next = 0
  for (const community of communities.values()) {
    if (!remap.has(community)) {
      remap.set(community, next)
      next += 1
    }
  }
  for (const [id, community] of communities) {
    communities.set(id, remap.get(community) ?? 0)
  }
  return communities
}

function clusterByDegree(graph: WikiGraph): Map<string, number> {
  return clusterLouvain(graph)
}

function findGraphInsights(graph: WikiGraph, communities: Map<string, number>): GraphInsight[] {
  const insights: GraphInsight[] = []

  for (const edge of graph.edges) {
    const leftC = communities.get(edge.from)
    const rightC = communities.get(edge.to)
    if (
      leftC !== undefined &&
      rightC !== undefined &&
      leftC !== rightC &&
      edge.weight >= 3 &&
      edge.signals.includes('wikilink')
    ) {
      insights.push({
        kind: 'surprise',
        detail: `跨社区连接：${edge.from} ↔ ${edge.to}`,
        nodes: [edge.from, edge.to]
      })
    }
  }

  for (const node of graph.nodes) {
    if (node.degree === 0 && node.relative) {
      insights.push({
        kind: 'gap',
        detail: `知识空白：${node.title} 无出边/入边`,
        nodes: [node.id]
      })
    }
  }

  return insights.slice(0, 24)
}

export { buildWikiGraph, clusterByDegree, clusterLouvain, findGraphInsights }
export type { GraphNode, GraphEdge, WikiGraph, GraphInsight }
