/**
 * 面板级加载态：assistant-ui 的 `Shimmer`（loading-state 元素）。
 *
 * 比转圈图标多两点好处：文字本身就是骨架（不需要猜「转多久」），
 * 且和聊天气泡里的思考态是同一种视觉语言，右栏与对话区看起来是同一个产品。
 */
import { Shimmer } from '@cogito/design/assistant/shimmer'
import { cn } from 'cn'

interface AgentLoadingProps {
  label: string
  className?: string
}

function AgentLoading(props: AgentLoadingProps) {
  return (
    <Shimmer
      as="span"
      className={cn('text-muted-foreground text-xs', props.className)}>
      {props.label}
    </Shimmer>
  )
}

export { AgentLoading }
