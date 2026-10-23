import { TooltipProvider } from '@cogito/design/components/tooltip'

import { ApprovalSwitch } from './approval-switch'
import { ComposerClip } from './composer-clip.tsx'
import { ComposerContextMenu } from './composer-context-menu.tsx'

/**
 * 输入区左下角：`+` / 回形针 / 审批（对齐 Qoder 从左到右）。
 * `ComposerAttach: null` 关掉库自带选文件按钮。
 */
function ComposerActions() {
  return (
    <TooltipProvider>
      <ComposerContextMenu />
      <ComposerClip />
      <ApprovalSwitch />
    </TooltipProvider>
  )
}

export { ComposerActions }
