/**
 * 工具折叠条（覆盖 `ThreadComponents.ToolGroup`），对齐 studio / Qoder 口径。
 */
import { useAuiState } from '@assistant-ui/react'
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger
} from '@cogito/design/assistant/tool-group.aui'
import type { ThreadGroupPart } from '@cogito/design/assistant/thread.aui'
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
  // 本段工具正在跑：指示转圈
  const isActive = isMessageRunning && group.status.type === 'running'
  // 整轮生成期间保持展开：若「段结束就收起」，工具卡会在回答还没出完时消失，
  // 只剩「N tool calls」折叠条，看起来像「没有工具记录」。回合结束后交给外层过程摘要收。
  const isOpen = userOpen ?? (isMessageRunning || isActive)

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
