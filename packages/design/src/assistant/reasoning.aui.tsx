import { memo } from 'react'
import {
  useAuiState,
  type ReasoningMessagePartComponent,
  type ReasoningGroupComponent
} from '@assistant-ui/react'
import { useAssistantLabels } from './labels'
import { MarkdownText } from './markdown-text'
import { toThinkingHint } from './process-state'
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants
} from './reasoning'

export type { ReasoningRootProps } from './reasoning'

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />

const ReasoningGroupImpl: ReasoningGroupComponent = ({ children, startIndex, endIndex }) => {
  const labels = useAssistantLabels()
  const isReasoningStreaming = useAuiState((s) => {
    if (s.message.status?.type !== 'running') return false
    for (let index = startIndex; index <= endIndex; index++) {
      if (s.message.parts[index]?.status.type === 'running') return true
    }
    return false
  })

  // 「思考中… / 已思考」本身不含信息：附上最新一句在琢磨什么，不展开也知道走到了哪
  const hint = useAuiState((s) => {
    for (let index = endIndex; index >= startIndex; index -= 1) {
      const part = s.message.parts[index]
      if (part?.type !== 'reasoning') continue
      const found = toThinkingHint(part.text)
      if (found) return found
    }
    return undefined
  })

  return (
    <ReasoningRoot
      variant="ghost"
      streaming={isReasoningStreaming}>
      <ReasoningTrigger
        active={isReasoningStreaming}
        label={isReasoningStreaming ? labels.working : labels.reasoning()}
        detail={hint}
      />
      <ReasoningContent aria-busy={isReasoningStreaming}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

const Reasoning = memo(ReasoningImpl) as unknown as ReasoningMessagePartComponent & {
  Root: typeof ReasoningRoot
  Trigger: typeof ReasoningTrigger
  Content: typeof ReasoningContent
  Text: typeof ReasoningText
  Fade: typeof ReasoningFade
}

Reasoning.displayName = 'Reasoning'
Reasoning.Root = ReasoningRoot
Reasoning.Trigger = ReasoningTrigger
Reasoning.Content = ReasoningContent
Reasoning.Text = ReasoningText
Reasoning.Fade = ReasoningFade

/**
 * @deprecated This wrapper targets the legacy `components.ReasoningGroup`
 * prop on `<MessagePrimitive.Parts>`. Use `<MessagePrimitive.GroupedParts>`
 * with a `groupBy` returning `"group-reasoning"` and compose `ReasoningRoot`
 * / `ReasoningTrigger` / `ReasoningContent` / `ReasoningText` directly.
 * See `thread.aui.tsx` for an example.
 */
const ReasoningGroup = memo(ReasoningGroupImpl)
ReasoningGroup.displayName = 'ReasoningGroup'

export {
  Reasoning,
  ReasoningGroup,
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants
}
