import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface AgentTask {
  id: string
  status: string
  createdAt: number
  updatedAt: number
  [key: string]: unknown
}

const ENV = { env: 'thinking' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_AGENT_TASK(id: string) {
  return unwrap(http.get<RSF<AgentTask>>(`/agent/tasks/${id}`, ENV))
}

export { GET_AGENT_TASK }
export type { AgentTask }
