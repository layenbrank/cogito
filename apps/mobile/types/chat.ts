type ChatRole = 'system' | 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
}

interface ChatCompletionMessage {
  role: ChatRole
  content: string
}

interface ChatCompletionBody {
  model: string
  messages: ChatCompletionMessage[]
  stream?: boolean
  temperature?: number
}

/** Aligns with rust-service `ModelR`. */
interface GatewayModel {
  id: string
  providerID: string
  name: string
  label: string
  allowRoles?: string[] | null
  enabled: boolean
  dailyTokenQuota: number
  createdAt: number
  updatedAt: number
}

export type { ChatCompletionBody, ChatCompletionMessage, ChatMessage, ChatRole, GatewayModel }
