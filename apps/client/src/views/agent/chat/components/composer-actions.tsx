import { TooltipProvider } from '@cogito/design/components/tooltip'

import { ApprovalSwitch } from './approval-switch'
import { ComposerClip } from './composer-clip.tsx'
import { ComposerKnowledge } from './composer-knowledge.tsx'
import { AgentModeSwitch } from './mode-switch.tsx'

/**
 * 输入区左下角：知识库 / 回形针 / 审批 / 模式（对齐 Qoder 从左到右）。
 *
 * 原来的 `+` 面板已拆掉：工作区、技能都在右栏有页签，MCP 插件列表搬到了右栏「扩展」；
 * 这里只保留「知识库」—— 它要在输入框旁边就地引用文档，右栏做不到「引完继续写」。
 * `ComposerAttach: null` 关掉库自带选文件按钮。
 */
function ComposerActions() {
  return (
    <TooltipProvider>
      <ComposerKnowledge />
      <ComposerClip />
      <ApprovalSwitch />
      <AgentModeSwitch />
    </TooltipProvider>
  )
}

export { ComposerActions }
