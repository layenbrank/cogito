import dayjs from 'dayjs'
import { toast } from 'sonner'
import { v4 as UUIDV4 } from 'uuid'

import type { SenderChip } from './sender-trigger'
import type { PlanPaneSource } from './plan-pane'
import { CONTEXT_MESSAGE_LIMIT, findSystemPrompt } from './workbench-constants'
import { runAgentLoop } from '@/features/agent/model/agent-loop'
import { appendAttachedPaths } from '@/features/agent/model/agent-tools'
import type { ScenarioKey } from '@/features/agent/model/scenarios'
import {
  COMPARE_PROMPT,
  extractLastCodeBlock,
  parseCompare,
  parseParts,
  parsePlan,
  PLAN_PROMPT,
  stringifyParts
} from '@/features/agent/model/tools'
import { findIsPathUnderRoots, normalizePath } from '@/features/agent/model/workspace-path'
import { WorkspaceFiles } from '@/lib/workspace-files'
import { resolveProviderConfig } from '@/features/agent/model/provider-credentials'
import type { ChatMessage, FilePartData, MessagePart } from '@/features/agent/types'
import { useAgentStore, type Message, type Session } from '@/stores/agent'
import type { AgentProvider } from '@/stores/provider'

interface StreamBuffer {
  fragment: string
  thinking: string
  messageID: string | null
}

interface SubmitAgentMessageInput {
  fragment: string
  chips: SenderChip[]
  scenario: ScenarioKey
  contextFiles: FilePartData[]
  sessionMessages: Message[]
  activeSessionID: string | null
  activeProvider: AgentProvider
  bufferRef: { current: StreamBuffer }
  timerRef: { current: number | null }
  abortRef: { current: AbortController | null }
  flushBatchUpdate: () => void
  onStreamingID: (id: string | null) => void
  onClearInput: () => void
  onContextFilesChange: React.Dispatch<React.SetStateAction<FilePartData[]>>
  onPlanOpen: (source: PlanPaneSource) => void
}

async function ensureSession(
  activeSessionID: string | null
): Promise<{ id: string; created: boolean }> {
  if (activeSessionID) return { id: activeSessionID, created: false }
  const session: Session = {
    id: UUIDV4(),
    title: '新对话 ' + dayjs().format('MM-DD HH:mm'),
    pinned: false,
    providerID: null,
    workspaceID: useAgentStore.getState().activeWorkspaceID,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  await useAgentStore.getState().toWriteSession([session])
  useAgentStore.getState().toReadSession(session.id)
  return { id: session.id, created: true }
}

function collectFileParts(contextFiles: FilePartData[], chips: SenderChip[]): MessagePart[] {
  const fileParts: MessagePart[] = contextFiles.map(function (file) {
    return { type: 'file', data: file }
  })
  chips.forEach(function (chip) {
    const path = (chip.meta.path || chip.meta.relative || '').replace(/\\/g, '/')
    if (!path) return
    const exists = fileParts.some(function (part) {
      return part.type === 'file' && part.data.path.replace(/\\/g, '/') === path
    })
    if (exists) return
    fileParts.push({
      type: 'file',
      data: {
        path,
        name: chip.meta.name || chip.label || path.split('/').pop() || path
      }
    })
  })
  return fileParts
}

function findWorkspaceRoots() {
  const workspaceFolders = useAgentStore.getState().workspaceFolders
  const activeWorkspaceID = useAgentStore.getState().activeWorkspaceID
  return workspaceFolders
    .filter(function (folder) {
      return folder.workspaceID === activeWorkspaceID
    })
    .map(function (folder) {
      return normalizePath(folder.path)
    })
}

async function buildScenarioParts(
  scenario: ScenarioKey,
  finalFragment: string,
  assistantId: string,
  attachedSnapshot: FilePartData[],
  roots: string[],
  onPlanOpen: (source: PlanPaneSource) => void
): Promise<MessagePart[]> {
  const parts: MessagePart[] = []
  const existing = parseParts(
    useAgentStore.getState().messages.find(function (item) {
      return item.id === assistantId
    })?.parts ?? null
  )
  existing.forEach(function (part) {
    if (part.type === 'tool') parts.push(part)
  })

  if (scenario === 'compare') {
    const compare = parseCompare(finalFragment)
    if (compare) parts.push({ type: 'compare', data: compare })
  } else if (scenario === 'plan') {
    const plan = parsePlan(finalFragment)
    if (plan) {
      parts.push({ type: 'plan', data: plan })
      onPlanOpen({
        messageID: assistantId,
        partIndex: parts.length - 1,
        data: plan
      })
    }
  } else if (scenario === 'code' && attachedSnapshot.length === 1) {
    const after = extractLastCodeBlock(finalFragment)
    const target = attachedSnapshot[0]
    if (after && findIsPathUnderRoots(target.path, roots)) {
      let before: string | undefined
      try {
        before = (await WorkspaceFiles.readFile(roots, target.path)).content
      } catch (error) {
        // 新增文件 / 越界读不到旧内容：diff 按「无 before」渲染，但留痕
        console.warn('[workbench] 读取 diff 前内容失败，按新增文件处理:', error)
        before = undefined
      }
      parts.push({ type: 'diff', data: { path: target.path, before, after } })
    }
  }

  return parts
}

async function submitAgentMessage(input: SubmitAgentMessageInput) {
  const text = input.fragment.trim()
  if (!text) return

  try {
    const { id: sessionID, created } = await ensureSession(input.activeSessionID)

    let userContent = text
    if (input.scenario === 'compare') userContent = COMPARE_PROMPT + text
    else if (input.scenario === 'plan') userContent = PLAN_PROMPT + text

    const fileParts = collectFileParts(input.contextFiles, input.chips)
    const attachedPaths = fileParts
      .filter(function (part): part is Extract<MessagePart, { type: 'file' }> {
        return part.type === 'file'
      })
      .map(function (part) {
        return normalizePath(part.data.path)
      })
      .filter(Boolean)

    const roots = findWorkspaceRoots()
    const displayFragment = userContent
    const transferUser = appendAttachedPaths(displayFragment, attachedPaths)

    input.onClearInput()
    const attachedSnapshot = input.contextFiles.slice()
    input.onContextFilesChange([])

    const now = Date.now()
    const personal: Message = {
      id: UUIDV4(),
      sessionID,
      createdAt: now,
      updatedAt: now,
      identity: 'user',
      fragment: displayFragment,
      thinking: null,
      parts: stringifyParts(fileParts)
    }
    const assistant: Message = {
      id: UUIDV4(),
      sessionID,
      createdAt: now + 1,
      updatedAt: now + 1,
      identity: 'assistant',
      fragment: '',
      thinking: '',
      parts: null
    }
    await useAgentStore.getState().toWriteMessage([personal])
    await useAgentStore.getState().toWriteMessage([assistant])

    const history = created ? [] : input.sessionMessages.slice(-CONTEXT_MESSAGE_LIMIT)
    const transfer: ChatMessage[] = [
      { role: 'system', content: findSystemPrompt(input.scenario) },
      ...history.map(function (item) {
        return {
          role: item.identity as ChatMessage['role'],
          content: item.fragment,
          thinking: item.thinking ?? undefined
        }
      }),
      { role: 'user', content: transferUser }
    ]

    const config = await resolveProviderConfig(input.activeProvider)
    const controller = new AbortController()
    input.abortRef.current = controller
    input.onStreamingID(assistant.id)
    input.bufferRef.current = { fragment: '', thinking: '', messageID: assistant.id }

    const enableTools = input.scenario === 'general' || input.scenario === 'code'

    try {
      const result = await runAgentLoop({
        config,
        messages: transfer,
        context: { roots },
        enableTools,
        sessionID,
        signal: controller.signal,
        onTextDelta: function (content, thinkingText) {
          input.bufferRef.current.fragment = content
          input.bufferRef.current.thinking = thinkingText
          if (input.timerRef.current === null) {
            input.timerRef.current = window.setTimeout(input.flushBatchUpdate, 0)
          }
        },
        onToolPart: function () {
          if (input.timerRef.current === null) {
            input.timerRef.current = window.setTimeout(input.flushBatchUpdate, 0)
          }
        }
      })
      input.bufferRef.current.fragment = result.fragment
      input.bufferRef.current.thinking = result.thinking
      if (result.toolParts.length) {
        await useAgentStore.getState().toUpdateMessage([
          {
            id: assistant.id,
            parts: stringifyParts(result.toolParts),
            updatedAt: Date.now()
          }
        ])
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const reason = error instanceof Error ? error.message : String(error)
        console.warn('[workbench] 流式回复失败，已把原因写进对话:', error)
        input.bufferRef.current.fragment += `\n\n> 出错了：${reason}`
      }
    }

    if (input.timerRef.current !== null) {
      clearTimeout(input.timerRef.current)
      input.timerRef.current = null
    }

    const finalFragment = input.bufferRef.current.fragment
    const finalThinking = input.bufferRef.current.thinking
    const parts = await buildScenarioParts(
      input.scenario,
      finalFragment,
      assistant.id,
      attachedSnapshot,
      roots,
      input.onPlanOpen
    )

    await useAgentStore.getState().toUpdateMessage([
      {
        id: assistant.id,
        fragment: finalFragment,
        thinking: finalThinking || null,
        parts: stringifyParts(parts),
        updatedAt: Date.now()
      }
    ])
  } catch (error) {
    console.error('[workbench] handleSubmit failed', error)
    toast.error('发送失败，请重试')
  } finally {
    input.bufferRef.current = { fragment: '', thinking: '', messageID: null }
    input.abortRef.current = null
    input.onStreamingID(null)
  }
}

export { findWorkspaceRoots, submitAgentMessage }
export type { StreamBuffer, SubmitAgentMessageInput }
