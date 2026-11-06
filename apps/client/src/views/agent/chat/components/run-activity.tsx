/**
 * Agent 的活动流水折叠条（覆盖 `ThreadComponents.RunActivity`）。
 *
 * 元素本体在 `@cogito/design/assistant/run-activity`（口径见
 * docs/apps/client/assistant-ui-elements.md）。这里只做两件属于 app 的事：
 *
 * 1. 展开态里挂「耗时统计 + 轨迹瀑布」—— 设计包不知道 timing 从哪来；
 * 2. 折叠条与最终回答之间留一档间距（元素按 gap 排，不猜外部排版）。
 */
import { RunActivity } from '@cogito/design/assistant/run-activity'
import type { ThreadRunActivityProps } from '@cogito/design/assistant/thread.aui'

import { MessageTimingStats, MessageTrace } from '@/views/agent/chat/components/message-trace'

function AgentRunActivity(props: ThreadRunActivityProps) {
  return (
    <RunActivity
      status={props.status}
      statusLabel={props.statusLabel}
      durationLabel={props.durationLabel}
      entries={props.entries}
      attention={props.attention}
      className="mb-1"
      extra={
        <>
          <MessageTimingStats />
          <MessageTrace />
        </>
      }>
      {props.children}
    </RunActivity>
  )
}

export { AgentRunActivity }
