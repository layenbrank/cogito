import { TooltipProvider } from '@cogito/design/components/tooltip'

import { ApprovalSwitch } from './approval-switch'
import { ComposerClip } from './composer-clip.tsx'
import { AgentModeSwitch } from './mode-switch.tsx'

/**
 * 输入区左下角：回形针 / 审批 / 模式。
 *
 * 知识库已在右栏「知识库」页签实现，不再占 composer 入口。
 * `ComposerAttach: null` 关掉库自带选文件按钮。
 */
function ComposerActions() {
  return (
    <TooltipProvider>
      <ComposerClip />
      <ApprovalSwitch />
      <AgentModeSwitch />
    </TooltipProvider>
  )
}

export { ComposerActions }
