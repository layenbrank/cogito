import { Button } from '@i-thinking/design/components/button'
import { Skeleton } from '@i-thinking/design/components/skeleton'
import { Spinner } from '@i-thinking/design/components/spinner'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

/**
 * 列表「没东西可显示」的四种情形：读取中、读失败、确实没有、搜索没命中。
 *
 * 四种区分开是必要的：corex 没起来时标题栏、动作数、指令数都是空的，
 * 跟「一条指令都还没写」长得一模一样，只给一句「还没有指令」会让人去查错方向。
 *
 * 卡片墙与左栏共用一套：差别只在字号与留白，靠 `isCompact` 一档切换，
 * 免得两边各抄一份、文案越抄越不一样。
 */

type PlaceholderState = 'loading' | 'error' | 'empty' | 'no-match'

interface PlaceholderAction {
  label: string
  icon?: string
  variant?: 'default' | 'outline'
  onClick: () => void
}

const PLACEHOLDER_ICONS: Record<PlaceholderState, string> = {
  loading: 'mdi:loading',
  error: 'mdi:alert-circle-outline',
  empty: 'mdi:file-document-outline',
  'no-match': 'mdi:magnify'
}

const PLACEHOLDER_TEXT: Record<PlaceholderState, string> = {
  loading: '正在读取指令…',
  error: '没能读取指令目录',
  empty: '还没有指令',
  'no-match': '没有匹配的指令'
}

interface Props {
  state: PlaceholderState
  /** 换掉默认文案（动作库说的是「动作」，不是「指令」） */
  label?: string
  /** 换掉默认图标（同上） */
  icon?: string
  /** 读失败的原因，原样来自 corex —— 让用户能拿它去 CLI 复现 */
  detail?: string | null
  isCompact?: boolean
  actions?: readonly PlaceholderAction[]
}

function LoadingSkeleton(props: { isCompact?: boolean }) {
  if (props.isCompact) {
    return (
      <div className="flex w-full flex-col gap-2 px-1 pt-2">
        {Array.from({ length: 4 }, function (_, i) {
          return (
            <Skeleton
              key={i}
              className="h-14 w-full rounded-xl"
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="grid w-full gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }, function (_, i) {
        return (
          <Skeleton
            key={i}
            className="h-28 w-full rounded-2xl"
          />
        )
      })}
    </div>
  )
}

function DirectivePlaceholder(props: Props) {
  const { state, label, icon, detail, isCompact, actions = [] } = props
  const isFailed = state === 'error'

  if (state === 'loading') {
    return (
      <div
        className={cn(
          'flex flex-col items-center text-muted-foreground',
          isCompact ? 'gap-2 px-1 py-2 text-xs' : 'gap-3 px-0 py-2 text-sm'
        )}
        role="status"
        aria-live="polite"
        aria-label={label ?? PLACEHOLDER_TEXT.loading}>
        <LoadingSkeleton isCompact={isCompact} />
        <span className="flex items-center gap-2 pt-2 text-xs">
          <Spinner className="size-3.5" />
          {label ?? PLACEHOLDER_TEXT.loading}
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center text-center text-muted-foreground',
        isCompact ? 'gap-2 px-3 py-10 text-xs' : 'gap-3 px-6 py-24 text-sm'
      )}>
      <Icon
        icon={icon ?? PLACEHOLDER_ICONS[state]}
        className={cn(isCompact ? 'size-6' : 'size-8', 'opacity-60')}
      />
      <p className={isFailed ? 'text-destructive' : undefined}>
        {label ?? PLACEHOLDER_TEXT[state]}
      </p>
      {detail ? (
        <p
          className={cn(
            'max-w-md rounded-md bg-muted px-2 py-1 font-mono text-xs break-words opacity-80'
          )}>
          {detail}
        </p>
      ) : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {actions.map(function (action) {
            return (
              <Button
                key={action.label}
                type="button"
                variant={action.variant ?? 'outline'}
                size={isCompact ? 'xs' : 'sm'}
                className="cursor-pointer"
                onClick={action.onClick}>
                {action.icon ? <Icon icon={action.icon} /> : null}
                {action.label}
              </Button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export { DirectivePlaceholder }
export type { PlaceholderAction, PlaceholderState }
