import { memo, useCallback, useRef } from 'react'
import {
  useScrollLock,
  useAuiState,
  type ReasoningMessagePartComponent,
  type ReasoningGroupComponent
} from '@assistant-ui/react'
import { useAssistantLabels } from './labels'
import { MarkdownText } from './markdown-text'
import {
  ANIMATION_DURATION,
  ReasoningRoot as ReasoningRootBase,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants,
  type ReasoningRootProps
} from './reasoning'

export type { ReasoningRootProps } from './reasoning'

/** `ReasoningRoot` with the thread viewport scroll locked during disclosure animations. */
function ReasoningRoot({ ref, onAnimationStart, instant, ...props }: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement | null>(null)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)

  const handleAnimationStart = useCallback(() => {
    // instant 过程摘要跳过锁滚动：内容巨大时锁 200ms 反而像卡死
    if (!instant) lockScroll()
    onAnimationStart?.()
  }, [instant, lockScroll, onAnimationStart])

  const composedRef = useCallback(
    (node: HTMLDivElement | null) => {
      collapsibleRef.current = node
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )

  return (
    <ReasoningRootBase
      ref={composedRef}
      instant={instant}
      onAnimationStart={handleAnimationStart}
      {...props}
    />
  )
}

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

  return (
    <ReasoningRoot
      variant="ghost"
      streaming={isReasoningStreaming}>
      <ReasoningTrigger
        active={isReasoningStreaming}
        label={isReasoningStreaming ? labels.working : labels.reasoning()}
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
