/**
 * 工具折叠条（覆盖 `ThreadComponents.ToolGroup`），对齐 studio / Qoder 口径。
 */
import { useAuiState } from '@assistant-ui/react'
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger
} from '@i-thinking/design/assistant/tool-group.aui'
import type { ThreadGroupPart } from '@i-thinking/design/assistant/thread.aui'
import { useState, type PropsWithChildren } from 'react'

import { countToolFailures } from '@/features/agent/tool-stats'

interface ToolGroupProps {
  group: ThreadGroupPart
}

function AgentToolGroup(props: PropsWithChildren<ToolGroupProps>) {
  const parts = useAuiState(function (state) {
    return state.message.parts
  })
  const [userOpen, updateUserOpen] = useState<boolean | null>(null)

  const group = props.group
  const count = group.indices.length
  const failed = countToolFailures(parts, group.indices)
  const isMessageRunning = useAuiState(function (state) {
    return state.message.status?.type === 'running'
  })
  // 本段工具跑完即收起（对齐 Cursor「Ran command」），不跟整轮挂着
  const isActive = isMessageRunning && group.status.type === 'running'
  const isOpen = userOpen ?? isActive

  return (
    <ToolGroupRoot
      variant="ghost"
      open={isOpen}
      onOpenChange={function (open) {
        if (open === isOpen) return
        updateUserOpen(open)
      }}>
      <ToolGroupTrigger
        count={count}
        failed={failed}
        active={isActive}
      />
      <ToolGroupContent>{props.children}</ToolGroupContent>
    </ToolGroupRoot>
  )
}

export { AgentToolGroup }
