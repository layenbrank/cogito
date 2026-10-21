import { Avatar, AvatarFallback, AvatarImage } from '@i-thinking/design/components/avatar'
import { Button } from '@i-thinking/design/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@i-thinking/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { CommandPalette } from '@/components/shell/command-palette.tsx'
import { RailTriggerBar, RailTriggerEdge } from '@/components/shell/rail-trigger.tsx'
import { SortableNav } from '@/components/shell/sortable-nav.tsx'
import { TopBar } from '@/components/shell/top-bar.tsx'
import { useConsoleLayoutStore } from '@/stores/console-layout.ts'
import { useSessionStore } from '@/stores/session.ts'
import { findAuthToken, subscribeAuthToken } from '@/utils/auth.ts'

function findRoleLabel(role: string | undefined) {
  if (!role) return '操作员'
  const key = role.toUpperCase()
  if (key === 'ADMIN') return '管理员'
  if (key === 'OPERATOR') return '运维'
  if (key === 'VIEWER') return '只读'
  return role
}

function findInitials(name: string | undefined) {
  if (!name) return '?'
  return name.slice(0, 1).toUpperCase()
}

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const token = useSyncExternalStore(subscribeAuthToken, findAuthToken, findAuthToken)
  const user = useSessionStore(function (state) {
    return state.user
  })
  const isSessionLoading = useSessionStore(function (state) {
    return state.isLoading
  })
  const toSignOut = useSessionStore(function (state) {
    return state.toSignOut
  })
  const hydrateFromServer = useConsoleLayoutStore(function (state) {
    return state.hydrateFromServer
  })
  const isRailCollapsed = useConsoleLayoutStore(function (state) {
    return state.isRailCollapsed
  })
  const toggleRailCollapsed = useConsoleLayoutStore(function (state) {
    return state.toggleRailCollapsed
  })
  const [commandOpen, updateCommandOpen] = useState(false)
  const [signOutOpen, updateSignOutOpen] = useState(false)
  /** 宽度跟 isRailCollapsed；图标居中布局等 width 过渡结束再切，避免中途 justify-center 跳动 */
  const [isIconMode, updateIconMode] = useState(isRailCollapsed)

  // loader 只拦首屏；会话失效清令牌后要在壳层立刻踢回登录，不能继续停在业务页
  useEffect(
    function () {
      if (isSessionLoading) return
      if (token) return
      const next = location.pathname + location.search
      const target =
        next && next !== '/' && !next.startsWith('/signin')
          ? `/signin?next=${encodeURIComponent(next)}`
          : '/signin'
      void navigate(target, { replace: true })
    },
    [isSessionLoading, location.pathname, location.search, navigate, token]
  )

  useEffect(
    function () {
      void hydrateFromServer()
    },
    [hydrateFromServer]
  )

  useEffect(
    function () {
      if (!isRailCollapsed) {
        updateIconMode(false)
        return
      }
      const preferReduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (preferReduced) {
        updateIconMode(true)
        return
      }
      const timer = window.setTimeout(function () {
        updateIconMode(true)
      }, 280)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [isRailCollapsed]
  )

  const openCommand = useCallback(function () {
    updateCommandOpen(true)
  }, [])

  useEffect(
    function () {
      function onKeyDown(event: KeyboardEvent) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          updateCommandOpen(true)
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
          event.preventDefault()
          toggleRailCollapsed()
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [toggleRailCollapsed]
  )

  return (
    <TooltipProvider delay={200}>
      <div className="flex h-full min-h-0">
        {/*
          折叠动效契约：
          1) 外层只过渡 width（Naive collapse-mode=width / Element aside）
          2) 内层 overflow:hidden 裁切，内容始终左对齐，禁止折叠瞬间 justify-center
          3) 文案用 opacity/max-width 淡出，避免「先挤到右侧再跟着缩」
        */}
        <div
          data-collapsed={isRailCollapsed || undefined}
          className="relative shrink-0 transition-[width] duration-[var(--backend-rail-duration)] ease-[var(--backend-rail-ease)] motion-reduce:transition-none"
          style={{
            width: isRailCollapsed
              ? 'var(--backend-rail-collapsed-width)'
              : 'var(--backend-rail-width)'
          }}>
          <aside className="flex h-full w-full flex-col overflow-hidden border-r border-[var(--backend-rail-border)] bg-[var(--backend-rail)] text-[var(--backend-rail-fg)]">
            <div
              className={clsx(
                'flex h-14 shrink-0 items-center',
                isIconMode ? 'w-full justify-center px-0' : 'gap-2.5 px-3'
              )}>
              <span
                className={clsx(
                  'flex shrink-0 items-center justify-center rounded-md font-semibold tracking-tight',
                  isIconMode
                    ? 'size-[var(--backend-rail-icon-hit)] text-[length:calc(var(--backend-rail-icon-glyph)*0.85)]'
                    : 'size-9 text-sm'
                )}
                style={{
                  background: 'var(--backend-accent-soft)',
                  color: 'var(--backend-accent)'
                }}>
                iT
              </span>
              {!isIconMode ? (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs tracking-[0.14em] text-[var(--backend-rail-muted)] uppercase">
                    i-thinking
                  </p>
                  <h1 className="truncate text-sm font-semibold tracking-tight">Backend</h1>
                </div>
              ) : null}
            </div>

            <div
              className={clsx(
                'min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-0 pb-2',
                isIconMode &&
                  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              )}>
              <SortableNav
                isRailNarrow={isRailCollapsed}
                isIconMode={isIconMode}
              />
            </div>

            <div
              className={clsx(
                'shrink-0 border-t border-[var(--backend-rail-border)] py-3',
                isIconMode ? 'w-full px-0' : 'px-3'
              )}>
              {isIconMode ? (
                <div className="flex w-full flex-col items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="flex size-[var(--backend-rail-icon-hit)] items-center justify-center rounded-md"
                          aria-label={user?.username ?? '未登录'}>
                          <Avatar className="!size-[var(--backend-rail-icon-glyph)]">
                            {user?.avatarUrl ? (
                              <AvatarImage
                                src={user.avatarUrl}
                                alt={user.username}
                              />
                            ) : null}
                            <AvatarFallback className="bg-[var(--backend-accent-soft)] text-[length:calc(var(--backend-rail-icon-glyph)*0.45)] text-[var(--backend-accent)]">
                              {findInitials(user?.username)}
                            </AvatarFallback>
                          </Avatar>
                        </button>
                      }
                    />
                    <TooltipContent side="right">
                      {user?.username ?? '未登录'} · {findRoleLabel(user?.role)}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="!size-[var(--backend-rail-icon-hit)] text-[var(--backend-rail-muted)] hover:bg-[var(--backend-rail-hover)] hover:text-[var(--backend-rail-fg)]"
                    aria-label="退出登录"
                    title="退出登录"
                    onClick={function () {
                      updateSignOutOpen(true)
                    }}>
                    <Icon
                      icon="lucide:log-out"
                      width="var(--backend-rail-icon-glyph)"
                      height="var(--backend-rail-icon-glyph)"
                      className="size-[var(--backend-rail-icon-glyph)]"
                    />
                  </Button>
                </div>
              ) : (
                <div className="flex h-10 items-center gap-2.5">
                  <Avatar className="size-8 shrink-0">
                    {user?.avatarUrl ? (
                      <AvatarImage
                        src={user.avatarUrl}
                        alt={user.username}
                      />
                    ) : null}
                    <AvatarFallback className="bg-[var(--backend-accent-soft)] text-xs text-[var(--backend-accent)]">
                      {findInitials(user?.username)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight text-[var(--backend-rail-fg)]">
                      {user?.username ?? '未登录'}
                    </p>
                    <p className="truncate text-xs leading-tight text-[var(--backend-rail-muted)]">
                      {findRoleLabel(user?.role)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-8 shrink-0 text-[var(--backend-rail-muted)] hover:bg-[var(--backend-rail-hover)] hover:text-[var(--backend-rail-fg)]"
                    aria-label="退出登录"
                    title="退出登录"
                    onClick={function () {
                      updateSignOutOpen(true)
                    }}>
                    <Icon
                      icon="lucide:log-out"
                      className="size-4"
                    />
                  </Button>
                </div>
              )}
            </div>

            <RailTriggerBar
              isCollapsed={isRailCollapsed}
              onToggle={toggleRailCollapsed}
            />
          </aside>

          <RailTriggerEdge
            isCollapsed={isRailCollapsed}
            onToggle={toggleRailCollapsed}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col bg-[var(--backend-canvas)]">
          <TopBar
            isRailCollapsed={isRailCollapsed}
            onToggleRail={toggleRailCollapsed}
            onOpenCommand={openCommand}
          />
          <main className="min-h-0 flex-1 overflow-auto">
            <div className="flex min-h-full flex-col p-3 lg:p-4">
              <Outlet />
            </div>
          </main>
        </div>

        <CommandPalette
          open={commandOpen}
          onOpenChange={updateCommandOpen}
        />
        <ConfirmDialog
          open={signOutOpen}
          title="退出登录？"
          description="将清除本机会话令牌，需要重新登录才能进入控制台。"
          confirmLabel="退出"
          destructive
          onOpenChange={updateSignOutOpen}
          onConfirm={function () {
            toSignOut()
            updateSignOutOpen(false)
            void navigate('/signin', { replace: true })
          }}
        />
      </div>
    </TooltipProvider>
  )
}

export { AppShell }
