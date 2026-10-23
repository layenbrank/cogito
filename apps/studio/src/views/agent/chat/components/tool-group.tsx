import { useAuiState } from '@assistant-ui/react'
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger
} from '@cogito/design/assistant/tool-group.aui'
import type { ThreadGroupPart } from '@cogito/design/assistant/thread.aui'
import { useState, type PropsWithChildren } from 'react'

import { countToolFailures } from '@/features/agent/tool-stats.ts'
import { AGENT_LABELS } from '@/features/chat/labels.ts'
import { useAgentStore } from '@/stores/agent.ts'

/**
 * 工具折叠条（覆盖 `ThreadComponents.ToolGroup`）。
 *
 * 设计包只看得到 `indices`，数不出失败次数 —— 成败在消息部件上，
 * 所以这里把部件读出来交给 `countToolFailures`，得到 Qoder 那句
 * 「执行工具 59 次，其中 2 次失败」。
 *
 * 展开状态用一个 `userOpen ?? 推导值` 表达，而不是 `useEffect` 去同步：
 * 推导值是纯的（「正在跑」或「用户要求默认展开」），用户手动点过之后才接管。
 */

interface ToolGroupProps {
  group: ThreadGroupPart
}

export function AgentToolGroup(props: PropsWithChildren<ToolGroupProps>) {
  const parts = useAuiState(function (state) {
    return state.message.parts
  })
  const showToolCount = useAgentStore(function (state) {
    return state.settings.chat.showToolCount
  })
  const expandTools = useAgentStore(function (state) {
    return state.settings.chat.expandTools
  })
  const [userOpen, updateUserOpen] = useState<boolean | null>(null)

  const group = props.group
  const count = group.indices.length
  const failed = countToolFailures(parts, group.indices)
  const isActive = group.status.type === 'running'
  const isOpen = userOpen ?? (isActive || expandTools)

  return (
    <ToolGroupRoot
      variant="ghost"
      open={isOpen}
      onOpenChange={updateUserOpen}>
      <ToolGroupTrigger
        count={count}
        failed={failed}
        active={isActive}
        {...(showToolCount ? {} : { label: AGENT_LABELS.toolCallsCompact })}
      />
      <ToolGroupContent>{props.children}</ToolGroupContent>
    </ToolGroupRoot>
  )
}
