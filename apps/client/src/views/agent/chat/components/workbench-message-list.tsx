import { Icon } from '@iconify/react/offline'
import { Spinner } from '@i-thinking/design/components/spinner'
import { clsx } from 'clsx'
import type { RefObject } from 'react'

import { AgentMessage } from './bubbles'
import type { PlanPaneSource } from './plan-pane'
import styles from './workbench.module.scss'
import type { PlanPartData } from '@/features/agent/types'
import type { Message } from '@/stores/agent'

interface WorkbenchMessageListProps {
  bubbleListRef: RefObject<HTMLDivElement | null>
  sessionMessages: Message[]
  streamingID: string | null
  onApplyDiff: (messageID: string, partIndex: number) => Promise<void>
  onTogglePlanItem: (messageID: string, partIndex: number, itemIndex: number) => Promise<void>
  onWritePlanToCalendar: (messageID: string, partIndex: number) => Promise<void>
  onPlanOpen: (source: PlanPaneSource) => void
  onCopyMessage: (messageID: string) => Promise<void>
  onDeleteMessage: (messageID: string) => void
}

function WorkbenchMessageList(props: WorkbenchMessageListProps) {
  return (
    <div
      ref={props.bubbleListRef}
      className={styles.bubbles}>
      <div className="flex flex-col gap-4">
        {props.sessionMessages.map(function (value) {
          const isUser = value.identity === 'user'
          const isStreaming = props.streamingID === value.id
          const isLoading = isStreaming && !value.fragment && !value.thinking
          return (
            <div
              key={value.id}
              className={clsx(
                styles.bubbleRow,
                isUser ? styles.bubbleRowUser : styles.bubbleRowAi
              )}>
              <span
                className={clsx(
                  styles.bubbleAvatar,
                  isUser ? styles.bubbleAvatarUser : styles.bubbleAvatarAi
                )}>
                <Icon
                  icon={isUser ? 'lucide:user' : 'lucide:bot'}
                  className="size-4"
                />
              </span>
              <div className={styles.bubbleContent}>
                {isLoading ? (
                  <Spinner className="text-muted-foreground" />
                ) : (
                  <AgentMessage
                    message={value}
                    streaming={isStreaming}
                    onApplyDiff={props.onApplyDiff}
                    onTogglePlanItem={props.onTogglePlanItem}
                    onWritePlanToCalendar={props.onWritePlanToCalendar}
                    onOpenPlanPane={function (messageID, partIndex, data: PlanPartData) {
                      props.onPlanOpen({ messageID, partIndex, data })
                    }}
                    onCopyMessage={props.onCopyMessage}
                    onDeleteMessage={props.onDeleteMessage}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { WorkbenchMessageList }
export type { WorkbenchMessageListProps }
