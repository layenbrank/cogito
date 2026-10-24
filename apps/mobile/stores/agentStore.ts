import { create } from 'zustand'

import { GET_MODELS, POST_CHAT_STREAM } from '@/api/gateway'
import { isApiSuccess } from '@/api/http'
import { findDefaultModel } from '@/constants/config'
import type { ChatCompletionMessage, ChatMessage, GatewayModel } from '@/types/chat'

interface AgentState {
  messages: ChatMessage[]
  models: GatewayModel[]
  model: string
  isStreaming: boolean
  isLoadingModels: boolean
  error: string | null
  hydrate: (token: string | null) => Promise<void>
  clear: () => void
  setModel: (model: string) => void
  send: (token: string, content: string) => Promise<void>
  abort: () => void
}

let abortController: AbortController | null = null

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toCompletionMessages(messages: ChatMessage[]): ChatCompletionMessage[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map(function (message) {
      return { role: message.role, content: message.content }
    })
}

const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  models: [],
  model: findDefaultModel(),
  isStreaming: false,
  isLoadingModels: false,
  error: null,

  async hydrate(token) {
    set({ model: get().model || findDefaultModel(), error: null })
    if (!token) {
      return
    }
    set({ isLoadingModels: true })
    try {
      const result = await GET_MODELS(token)
      if (!isApiSuccess(result.code)) {
        set({ error: result.msg, isLoadingModels: false })
        return
      }
      const enabled = (result.data ?? []).filter((item) => item.enabled)
      const preferred =
        enabled.find((item) => item.name === get().model)?.name ||
        enabled[0]?.name ||
        findDefaultModel()
      set({ models: enabled, model: preferred, isLoadingModels: false })
    } catch (error) {
      set({
        isLoadingModels: false,
        error: error instanceof Error ? error.message : 'Failed to load models'
      })
    }
  },

  clear() {
    abortController?.abort()
    abortController = null
    set({ messages: [], isStreaming: false, error: null })
  },

  setModel(model) {
    set({ model })
  },

  abort() {
    abortController?.abort()
    abortController = null
    set({ isStreaming: false })
  },

  async send(token, content) {
    const trimmed = content.trim()
    if (!trimmed || get().isStreaming) {
      return
    }

    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: trimmed,
      createdAt: Date.now()
    }
    const assistantId = createId('assistant')
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now()
    }

    const history = get().messages
    const requestMessages = [
      ...toCompletionMessages(history),
      { role: 'user' as const, content: trimmed }
    ]

    set({
      messages: [...history, userMessage, assistantMessage],
      isStreaming: true,
      error: null
    })

    abortController = new AbortController()

    try {
      await POST_CHAT_STREAM({
        token,
        model: get().model,
        signal: abortController.signal,
        messages: requestMessages,
        onDelta(text) {
          set({
            messages: get().messages.map(function (message) {
              if (message.id !== assistantId) {
                return message
              }
              return { ...message, content: `${message.content}${text}` }
            })
          })
        }
      })
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted')) {
        set({ isStreaming: false })
        return
      }
      const message = error instanceof Error ? error.message : 'Agent request failed'
      set({
        error: message,
        messages: get().messages.map(function (item) {
          if (item.id !== assistantId) {
            return item
          }
          return { ...item, content: item.content || `错误：${message}` }
        })
      })
    } finally {
      abortController = null
      set({ isStreaming: false })
    }
  }
}))

export { useAgentStore }
