import { TooltipProvider } from '@cogito/design/components/tooltip'

import { ComposerClip } from './composer-clip.tsx'
import { ComposerContextMenu } from './composer-context-menu.tsx'
import { ComposerInbound } from './composer-inbound.tsx'

/**
 * 输入区左下角：`+` 加上下文，回形针加附件。
 *
 * `@` / `/` 改由键入触发（`ComposerTriggers`），不再挂独立按钮。
 * `ComposerAttach: null` 关掉库自带选文件按钮，避免和这里叠两个加号。
 */
export function ComposerActions() {
  return (
    <TooltipProvider>
      <ComposerContextMenu />
      <ComposerClip />
      <ComposerInbound />
    </TooltipProvider>
  )
}
