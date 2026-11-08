/**
 * 用户消息上的「模式徽标」插槽。
 *
 * design 不认识业务模式（执行 / 计划 / 问答 / 目标），只提供位置与样式；
 * 哪条消息显示什么由业务侧注册解析器决定 —— 与 `message-citations` 的注入方式一致。
 *
 * 解析器拿到的 `metadata` 是消息的 `metadata.custom`（我们自己的扩展位）：
 * 模式快照随消息落库，所以刷新、切会话、重新生成都能复现「当初那一次」的选择。
 */
import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { cn } from 'cn'
import type { FC } from 'react'

interface UserMessageBadge {
  /** lucide 图标名，例如 `lucide:target` */
  icon: string
  label: string
  /** 悬浮说明（写给读屏与鼠标停留） */
  hint?: string
  /** 非默认模式用强调色，扫一眼就能分辨「这条是计划/目标模式发的」 */
  accent?: boolean
}

type UserMessageBadgeResolver = (message: {
  id: string
  metadata?: Readonly<Record<string, unknown>>
}) => UserMessageBadge | null

let resolver: UserMessageBadgeResolver | null = null

/** 业务侧注册解析器；传 null 注销（测试与嵌入式宿主用） */
function installUserMessageBadgeResolver(fn: UserMessageBadgeResolver | null) {
  resolver = fn
}

const UserMessageBadgeSlot: FC = () => {
  const id = useAuiState(function (state) {
    return state.message.id
  })
  const metadata = useAuiState(function (state) {
    return state.message.metadata
  })
  if (!resolver) return null
  const badge = resolver({ id, metadata: metadata?.custom })
  if (!badge) return null

  return (
    <span
      data-slot="aui_user-message-mode"
      data-mode-label={badge.label}
      title={badge.hint}
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        badge.accent ? 'text-primary/80 font-medium' : 'text-muted-foreground/70'
      )}>
      <Icon
        icon={badge.icon}
        className="size-3"
        aria-hidden
      />
      {badge.label}
    </span>
  )
}

export { UserMessageBadgeSlot, installUserMessageBadgeResolver }
export type { UserMessageBadge, UserMessageBadgeResolver }
