/**
 * Agent 会话 provider
 */
import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { openComponentRoute } from '@/features/command-bar/open-route'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import { useAgentStore } from '@/stores/agent'

function searchAgent(query: string): Hit[] {
  const sessions = useAgentStore.getState().sessions
  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? sessions.filter(function (session) {
        return session.title.toLowerCase().includes(normalized)
      })
    : sessions

  return filtered.slice(0, OMNIBAR_UI.LOCAL_LIMIT).map(function (session, index) {
    return {
      domain: 'agent' as const,
      id: session.id,
      title: session.title || '未命名会话',
      subtitle: 'Agent 会话',
      score: 1 - index * 0.01,
      icon: 'lucide:bot',
      async run() {
        useAgentStore.getState().toReadSession(session.id)
        await openComponentRoute('agent', {
          id: session.id,
          path: '/agent/chat'
        })
      }
    }
  })
}

const agentProvider: SearchProvider = {
  domain: 'agent',
  search(query) {
    return searchAgent(query)
  }
}

export { agentProvider }
