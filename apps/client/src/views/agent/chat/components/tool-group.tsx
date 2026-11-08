/**
 * 工具折叠条（覆盖 `ThreadComponents.ToolGroup`），对齐 studio / Qoder 口径。
 *
 * 2026-11：对话流改成**按块折叠**后（思考一段一条、工具一件一行），一轮里所有工具
 * 都平铺成各自的卡片，「N 次工具调用」这层分组默认不再出现。这里保留实现，
 * 供显式传入 `ThreadComponents.ToolGroup` 的宿主把连续工具收成一组。
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
  // 默认折叠（运行中也不自动展开）：正文按需点开，展开后 pin 住用户的这层选择。
  // 例外：组里有待审批的卡 —— 审批按钮不能藏在折叠里（强制展开且不许收起）
  const needsApproval = group.counts.requiresAction > 0
  const isOpen = needsApproval || (userOpen ?? false)

  return (
    <ToolGroupRoot
      variant="ghost"
      open={isOpen}
      onOpenChange={function (open) {
        if (needsApproval) return
        if (open === isOpen) return
        updateUserOpen(open)
      }}>
      <ToolGroupTrigger
        count={count}
        failed={failed}
        active={isActive}
        title={needsApproval ? '有待确认的工具调用，处理完才能收起' : undefined}
      />
      <ToolGroupContent>{props.children}</ToolGroupContent>
    </ToolGroupRoot>
  )
}

export { AgentToolGroup }
