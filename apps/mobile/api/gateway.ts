import { API_PATHS } from '@/constants/api'
import { findDefaultModel, findTenantId } from '@/constants/config'
import { ApiError, buildUrl, isApiSuccess, parseEnvelope, requestJson } from '@/api/http'
import type { ChatCompletionBody, ChatCompletionMessage, GatewayModel } from '@/types/chat'
import type { RSF } from '@/types/response'

interface StreamChatOptions {
  token: string
  messages: ChatCompletionMessage[]
  model?: string
  signal?: AbortSignal
  onDelta: (text: string) => void
}

/**
 * Parses one SSE `data:` payload from OpenAI-compatible stream chunks.
 */
function parseSseDelta(payload: string) {
  if (!payload || payload === '[DONE]') {
    return ''
  }
  try {
    const json = JSON.parse(payload) as {
      choices?: { delta?: { content?: string }; message?: { content?: string } }[]
      code?: number
      msg?: string
    }
    if (typeof json.code === 'number' && !isApiSuccess(json.code)) {
      throw new ApiError(json.code, json.msg ?? 'Gateway error')
    }
    const choice = json.choices?.[0]
    return choice?.delta?.content ?? choice?.message?.content ?? ''
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    return ''
  }
}

/**
 * Feeds incremental SSE text into the delta callback.
 */
function consumeSseBuffer(buffer: string, onDelta: (text: string) => void) {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  for (const line of parts) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) {
      continue
    }
    const delta = parseSseDelta(trimmed.slice(5).trim())
    if (delta) {
      onDelta(delta)
    }
  }
  return rest
}

/**
 * GET /api/v1/gateway/models
 */
async function GET_MODELS(token: string): Promise<RSF<GatewayModel[]>> {
  return requestJson<GatewayModel[]>(API_PATHS.GATEWAY_MODELS, {
    token,
    tenantId: findTenantId()
  })
}

/**
 * Streams via XMLHttpRequest progressive `onprogress` for React Native compatibility.
 */
function streamViaXhr(options: StreamChatOptions & { url: string; body: string }) {
  return new Promise<void>(function (resolve, reject) {
    const xhr = new XMLHttpRequest()
    let lastIndex = 0
    let buffer = ''

    function abortHandler() {
      xhr.abort()
    }

    options.signal?.addEventListener('abort', abortHandler)

    xhr.open('POST', options.url)
    xhr.setRequestHeader('Accept', 'text/event-stream')
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${options.token}`)
    const tenantId = findTenantId()
    if (tenantId) {
      xhr.setRequestHeader('X-Tenant-ID', tenantId)
    }
    xhr.responseType = 'text'

    xhr.onprogress = function () {
      const text = xhr.responseText ?? ''
      const chunk = text.slice(lastIndex)
      lastIndex = text.length
      if (!chunk) {
        return
      }
      try {
        buffer = consumeSseBuffer(buffer + chunk, options.onDelta)
      } catch (error) {
        options.signal?.removeEventListener('abort', abortHandler)
        xhr.abort()
        reject(error)
      }
    }

    xhr.onerror = function () {
      options.signal?.removeEventListener('abort', abortHandler)
      reject(new Error('Gateway network error'))
    }

    xhr.onload = function () {
      options.signal?.removeEventListener('abort', abortHandler)
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(xhr.responseText || `Gateway error ${xhr.status}`))
        return
      }
      try {
        const contentType = xhr.getResponseHeader('content-type') ?? ''
        if (!contentType.includes('text/event-stream')) {
          const json = JSON.parse(xhr.responseText) as {
            choices?: { message?: { content?: string } }[]
            code?: number
            msg?: string
          }
          if (typeof json.code === 'number' && !isApiSuccess(json.code)) {
            reject(new ApiError(json.code, json.msg ?? 'Gateway error'))
            return
          }
          const content = json.choices?.[0]?.message?.content
          if (content) {
            options.onDelta(content)
            resolve()
            return
          }
          reject(new Error(json.msg ?? 'Empty gateway response'))
          return
        }
        if (buffer.trim()) {
          consumeSseBuffer(`${buffer}\n`, options.onDelta)
        }
        resolve()
      } catch (error) {
        reject(error)
      }
    }

    xhr.send(options.body)
  })
}

/**
 * POST /api/v1/gateway/chat/completions (SSE preferred, XHR progressive on RN).
 */
async function POST_CHAT_STREAM(options: StreamChatOptions) {
  const model = options.model ?? findDefaultModel()
  const body: ChatCompletionBody = {
    model,
    messages: options.messages,
    stream: true
  }
  const url = buildUrl(API_PATHS.GATEWAY_CHAT)
  const payload = JSON.stringify(body)

  // Prefer XHR progressive streaming — more reliable on React Native than fetch body readers.
  if (typeof XMLHttpRequest !== 'undefined') {
    await streamViaXhr({ ...options, url, body: payload })
    return
  }

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.token}`
  }
  const tenantId = findTenantId()
  if (tenantId) {
    headers['X-Tenant-ID'] = tenantId
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: payload,
    signal: options.signal
  })

  if (!response.ok) {
    try {
      const envelope = await parseEnvelope<{ choices?: { message?: { content?: string } }[] }>(
        response.clone()
      )
      if (!isApiSuccess(envelope.code)) {
        throw new ApiError(envelope.code, envelope.msg)
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
    }
    const text = await response.text()
    throw new Error(text || `Gateway error ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
      code?: number
      msg?: string
    }
    if (typeof json.code === 'number' && !isApiSuccess(json.code)) {
      throw new ApiError(json.code, json.msg ?? 'Gateway error')
    }
    const content = json.choices?.[0]?.message?.content
    if (content) {
      options.onDelta(content)
      return
    }
    throw new Error(json.msg ?? 'Empty gateway response')
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    let buffer = ''
    buffer = consumeSseBuffer(`${text}\n`, options.onDelta)
    if (buffer.trim()) {
      consumeSseBuffer(`${buffer}\n`, options.onDelta)
    }
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    buffer = consumeSseBuffer(buffer, options.onDelta)
  }
  if (buffer.trim()) {
    consumeSseBuffer(`${buffer}\n`, options.onDelta)
  }
}

export { GET_MODELS, POST_CHAT_STREAM, parseSseDelta }
