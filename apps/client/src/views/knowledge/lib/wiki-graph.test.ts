import { describe, expect, it } from 'vitest'

import { buildWikiGraph, clusterLouvain, findGraphInsights } from '@/views/knowledge/lib/wiki-graph.ts'

describe('wiki-graph', function () {
  it('builds wikilink edges and communities', function () {
    const graph = buildWikiGraph([
      {
        relative: 'wiki/a.md',
        title: 'Alpha',
        content: 'See [[Beta]] and [[Gamma]]'
      },
      {
        relative: 'wiki/b.md',
        title: 'Beta',
        content: 'Back to [[Alpha]]'
      },
      {
        relative: 'wiki/c.md',
        title: 'Gamma',
        content: 'lonely'
      }
    ])
    expect(graph.nodes.length).toBeGreaterThanOrEqual(3)
    expect(graph.edges.some(function (edge) {
      return edge.signals.includes('wikilink')
    })).toBe(true)
    const communities = clusterLouvain(graph)
    expect(communities.size).toBe(graph.nodes.length)
    const insights = findGraphInsights(graph, communities)
    expect(Array.isArray(insights)).toBe(true)
  })
})
