/**
 * 知识库最近路径 provider
 */
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { openComponentRoute } from '@/features/command-bar/open-route'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import { uniqueBy } from '@/features/command-bar/unique'
import { useKnowledgeStore } from '@/stores/knowledge'

function findFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function searchKnowledge(query: string): Hit[] {
  const recentPaths = uniqueBy(
    useKnowledgeStore.getState().recentPaths ?? [],
    function (path) {
      return path.replace(/\\/g, '/').toLowerCase()
    }
  )
  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? recentPaths.filter(function (path) {
        return path.toLowerCase().includes(normalized)
      })
    : recentPaths

  return filtered.slice(0, OMNIBAR_UI.LOCAL_LIMIT).map(function (path, index) {
    return {
      domain: 'knowledge' as const,
      id: path,
      title: findFileName(path),
      subtitle: path,
      score: 1 - index * 0.01,
      icon: 'lucide:notebook-pen',
      async run() {
        useKnowledgeStore.getState().toBeginOpen(path)
        await openComponentRoute('knowledge', {
          id: path,
          path: `/knowledge?path=${encodeURIComponent(path)}`
        })
      }
    }
  })
}

const knowledgeProvider: SearchProvider = {
  domain: 'knowledge',
  search(query) {
    return searchKnowledge(query)
  }
}

export { knowledgeProvider }
