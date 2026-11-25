import { HttpEnvelope } from '@/utils/http/errors.ts'
import { http } from '@/utils/http/http.ts'

interface AgentTask {
  id: string
  status: string
  createdAt: number
  updatedAt: number
  [key: string]: unknown
}

const ENV = { env: 'cogito' as const }

async function unwrap<T>(pending: Promise<RSF<T>>): Promise<T> {
  return HttpEnvelope(await pending)
}

function GET_AGENT_TASKS(query: { status?: string; tenantID?: string } = {}) {
  return unwrap(http.get<RSF<AgentTask[]>>('/admin/agent/tasks', { ...ENV, query }))
}

function GET_AGENT_TASK(id: string) {
  return unwrap(http.get<RSF<AgentTask>>(`/agent/tasks/${id}`, ENV))
}

function POST_AGENT_APPROVAL(taskID: string, approvalID: string, decision: string) {
  return unwrap(
    http.post<RSF<unknown>>(
      `/agent/tasks/${taskID}/approvals/${approvalID}`,
      { decision },
      ENV
    )
  )
}

export { GET_AGENT_TASK, GET_AGENT_TASKS, POST_AGENT_APPROVAL }
export type { AgentTask }
