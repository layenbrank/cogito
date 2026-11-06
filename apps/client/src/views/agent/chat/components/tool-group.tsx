/**
 * 工具折叠条（覆盖 `ThreadComponents.ToolGroup`），对齐 studio / Qoder 口径。
 *
 * 2026-11：client 改成整轮活动流水（`ThreadComponents.RunActivity`）后，一轮里
 * 所有工具都摊进时间线条目，「N 次工具调用」这层分组不再出现在对话里 ——
 * 待审批的工具改由活动流水的 `attention` 槽常驻可见。这里保留实现，
 * 供未接入活动流水的宿主继续按分段方式渲染。
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
