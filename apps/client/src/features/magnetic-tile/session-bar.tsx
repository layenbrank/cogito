import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import {
  findAppComponent,
  isMainWindow,
  readSessions,
  subscribeSessions
} from '@/features/magnetic-tile/session'

/** 主窗口的应用页会在顶栏放会话切换，应用名不必再写一遍。 */
function useShowsTileSession() {
  const location = useLocation()
  return isMainWindow() && findAppComponent(location.pathname) !== null
}

/** 应用顶栏左侧：回主页，并在已打开的会话之间切换。 */
function TileSessionBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const sessions = useSyncExternalStore(subscribeSessions, readSessions)
  const current = findAppComponent(location.pathname)
  const label = current ? findComponentLabel(current) : '应用'

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        data-region="false"
        aria-label="返回"
        className="size-10 min-w-10 shrink-0 rounded-lg"
        onClick={function () {
          void navigate('/overview')
        }}>
        <Icon
          icon="lucide:undo-2"
          aria-hidden
        />
      </Button>
      {sessions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                data-region="false"
                aria-label="切换应用"
                className="h-10 max-w-36 gap-1 rounded-lg px-2.5"
              />
            }>
            <span className="truncate">{label}</span>
            <Icon
              icon="lucide:chevron-down"
              className="size-3 shrink-0"
              aria-hidden
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-36">
            {sessions.map(function (session) {
              const isCurrent = session.component === current
              return (
                <DropdownMenuItem
                  key={session.component}
                  onClick={function () {
                    if (isCurrent) return
                    void navigate(session.path)
                  }}>
                  <Icon
                    icon={isCurrent ? 'lucide:check' : 'lucide:app-window'}
                    aria-hidden
                  />
                  {findComponentLabel(session.component)}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  )
}

export { TileSessionBar, useShowsTileSession }
