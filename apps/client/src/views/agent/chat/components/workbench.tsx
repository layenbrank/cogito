/**
 * 主对话区：消息流编排（批量缓冲 + 中止 + 上下文注入 + 部件落库）
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@i-thinking/design/components/alert-dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { AgentComposer } from './composer'
import type { SenderChip } from './sender-trigger'
import type { PlanPaneSource } from './plan-pane'
import styles from './workbench.module.scss'
import {
  applyDiffPart,
  copyMessage,
  togglePlanItem,
  writePlanToCalendar
} from './workbench-actions'
import { type QuickPrompt } from './workbench-constants'
import { WorkbenchEmpty } from './workbench-empty'
import { WorkbenchMessageList } from './workbench-message-list'
import { submitAgentMessage, type StreamBuffer } from './workbench-submit'
import type { ScenarioKey } from '@/features/agent/model/scenarios'
import type { FilePartData } from '@/features/agent/types'
import { useAgentStore } from '@/stores/agent'
import { useProviderStore } from '@/stores/provider'

interface WorkbenchProps {
  className?: string
  scenario: ScenarioKey
  contextFiles: FilePartData[]
  onScenarioChange: (scenario: ScenarioKey) => void
  onContextFilesChange: React.Dispatch<React.SetStateAction<FilePartData[]>>
  onOpenSettings: () => void
  onPlanOpen: (source: PlanPaneSource) => void
}

function AgentWorkbench(props: WorkbenchProps) {
  const messages = useAgentStore(function (state) {
    return state.messages
  })
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })

  const [input, updateInput] = useState('')
  const [fillRequest, updateFillRequest] = useState<{ token: number; text: string } | null>(null)
  const scenario = props.scenario
  const [streamingID, updateStreamingID] = useState<string | null>(null)
  const [pendingDelete, updatePendingDelete] = useState<string | null>(null)
  const bubbleListRef = useRef<HTMLDivElement>(null)

  const bufferRef = useRef<StreamBuffer>({
    fragment: '',
    thinking: '',
    messageID: null
  })
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sessionMessages = useMemo(
    function () {
      if (!activeSessionID) return []
      return messages.filter(function (item) {
        return item.sessionID === activeSessionID
      })
    },
    [messages, activeSessionID]
  )

  const activeProvider =
    providers.find(function (provider) {
      return provider.id === activeProviderID && provider.enabled
    }) ?? null

  function flushBatchUpdate() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const buffer = bufferRef.current
    if (buffer.messageID) {
      void useAgentStore.getState().toUpdateMessage(
        [
          {
            id: buffer.messageID,
            fragment: buffer.fragment,
            thinking: buffer.thinking || null
          }
        ],
        { skip: true }
      )
    }
  }

  async function handleSubmit(fragment: string, chips: SenderChip[] = []) {
    if (!fragment.trim() || streamingID) return
    if (!activeProvider) {
      toast.warning('请先在模型设置中添加并选择模型接入')
      return
    }
    await submitAgentMessage({
      fragment,
      chips,
      scenario,
      contextFiles: props.contextFiles,
      sessionMessages,
      activeSessionID,
      activeProvider,
      bufferRef,
      timerRef,
      abortRef,
      flushBatchUpdate,
      onStreamingID: updateStreamingID,
      onClearInput: function () {
        updateInput('')
      },
      onContextFilesChange: props.onContextFilesChange,
      onPlanOpen: props.onPlanOpen
    })
  }

  function handleQuickPrompt(item: QuickPrompt) {
    props.onScenarioChange(item.scenario)
    updateInput(item.label)
    updateFillRequest(function (prev) {
      return { token: (prev?.token ?? 0) + 1, text: item.label }
    })
  }

  function handleAttachFile(file: FilePartData) {
    const path = file.path.replace(/\\/g, '/')
    props.onContextFilesChange(function (files) {
      const exists = files.some(function (item) {
        return item.path.replace(/\\/g, '/') === path
      })
      if (exists) return files
      return files.concat([{ ...file, path }])
    })
  }

  function handleRemoveFile(path: string) {
    const normalized = path.replace(/\\/g, '/')
    props.onContextFilesChange(function (files) {
      return files.filter(function (file) {
        return file.path.replace(/\\/g, '/') !== normalized
      })
    })
  }

  useEffect(
    function () {
      const list = bubbleListRef.current
      if (!list) return
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight
      if (distance > 160) return
      list.scrollTop = list.scrollHeight
    },
    [sessionMessages, streamingID]
  )

  return (
    <div className={props.className}>
      {sessionMessages.length === 0 ? (
        <WorkbenchEmpty onQuickPrompt={handleQuickPrompt} />
      ) : (
        <WorkbenchMessageList
          bubbleListRef={bubbleListRef}
          sessionMessages={sessionMessages}
          streamingID={streamingID}
          onApplyDiff={applyDiffPart}
          onTogglePlanItem={togglePlanItem}
          onWritePlanToCalendar={writePlanToCalendar}
          onPlanOpen={props.onPlanOpen}
          onCopyMessage={copyMessage}
          onDeleteMessage={updatePendingDelete}
        />
      )}
      <div className={styles.composer}>
        <AgentComposer
          value={input}
          fillRequest={fillRequest}
          loading={Boolean(streamingID)}
          scenario={scenario}
          files={props.contextFiles}
          onChange={updateInput}
          onAttach={handleAttachFile}
          onRemoveFile={handleRemoveFile}
          onOpenSettings={props.onOpenSettings}
          onSubmit={function (fragment, chips) {
            void handleSubmit(fragment, chips)
          }}
          onCancel={function () {
            abortRef.current?.abort()
          }}
        />
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={function (open) {
          if (!open) updatePendingDelete(null)
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条消息？</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={function () {
                const messageID = pendingDelete
                updatePendingDelete(null)
                if (messageID) void useAgentStore.getState().toRemoveMessage([messageID])
              }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { AgentWorkbench }
export type { WorkbenchProps }
