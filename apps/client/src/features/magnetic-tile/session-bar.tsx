import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@cogito/design/components/tooltip'
import { cn } from 'cn'
import { useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import {
  findAppComponent,
  isMainWindow,
  readSessions,
  subscribeSessions,
  type TileSession
} from '@/features/magnetic-tile/session'

/** 主窗口的应用页会在顶栏放会话切换，应用名不必再写一遍。 */
function useShowsTileSession() {
  const location = useLocation()
  return isMainWindow() && findAppComponent(location.pathname) !== null
}

/** 头像组最多露几个；其余折成「+N」，避免顶栏被长会话列表撑开 */
const FACES_CAP = 3

/**
 * 顶栏导航 + 活动应用头像组（取代原来的「返回 + 下拉」）。
 *
 * 三件事统一放这里，页面内不再各画一份：
 * - 后退：等同浏览器后退（`history.back`），跟着用户的实际路径走；
 * - 主页：固定回磁贴墙，位置不随层级变化；
 * - 已打开的应用：头像组（叠放小圆），当前那个高亮，点一下就切过去。
 *   下拉菜单要展开才知道有什么，属于「藏起来的导航」；头像组一眼看全，切换只需一次点击。
 */
function TileSessionBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const sessions = useSyncExternalStore(subscribeSessions, readSessions)
  const current = findAppComponent(location.pathname)
  const faces = sessions.slice(0, FACES_CAP)
  const rest = sessions.slice(FACES_CAP)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        data-region="false"
        aria-label="后退"
        className="size-10 min-w-10 shrink-0 rounded-lg"
        onClick={function () {
          // 用 history 而不是写死目标：用户可能是从概览、搜索或设置页进来的
          void navigate(-1)
        }}>
        <Icon
          icon="lucide:arrow-left"
          aria-hidden
        />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        data-region="false"
        aria-label="回到主页"
        className="size-10 min-w-10 shrink-0 rounded-lg"
        onClick={function () {
          void navigate('/overview')
        }}>
        <Icon
          icon="lucide:house"
          aria-hidden
        />
      </Button>
      {sessions.length > 0 ? (
        <div
          className="ml-1 flex items-center -space-x-1.5"
          role="group"
          aria-label="已打开的应用">
          {faces.map(function (session) {
            return (
              <SessionFace
                key={session.component}
                session={session}
                isCurrent={session.component === current}
                onPick={function () {
                  if (session.component === current) return
                  void navigate(session.path)
                }}
              />
            )
          })}
          {rest.length > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    data-region="false"
                    aria-label={`还有 ${rest.length} 个应用`}
                    className="flex size-7 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-medium text-muted-foreground ring-2 ring-background"
                  />
                }>
                +{rest.length}
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {rest
                  .map(function (session) {
                    return findComponentLabel(session.component)
                  })
                  .join('、')}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/** 单个应用头像：首字作标识，当前页高亮；hover 才出全名（顶栏不吃宽度） */
function SessionFace(props: {
  session: TileSession
  isCurrent: boolean
  onPick: () => void
}) {
  const label = findComponentLabel(props.session.component)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            data-region="false"
            aria-label={label}
            aria-current={props.isCurrent ? 'page' : undefined}
            className={cn(
              'size-7 min-w-7 rounded-full border border-border bg-muted text-[11px] font-medium',
              'ring-2 ring-background transition-colors hover:bg-accent hover:text-accent-foreground',
              props.isCurrent && 'border-primary text-primary'
            )}
            onClick={props.onPick}
          />
        }>
        {label.slice(0, 1)}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export { TileSessionBar, useShowsTileSession }
