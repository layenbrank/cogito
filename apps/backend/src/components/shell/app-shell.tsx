import { Avatar, AvatarFallback, AvatarImage } from '@cogito/design/components/avatar'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Kbd } from '@cogito/design/components/kbd'
import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ConfirmDialog } from '@/components/console/confirm-dialog.tsx'
import { CommandPalette } from '@/components/shell/command-palette.tsx'
import { ShortcutDialog } from '@/components/shell/shortcut-dialog.tsx'
import { NAV_GROUPS, NAV_ITEMS, findNavById, findNavItem } from '@/constants/nav.ts'
import { paintAppearance, type AppearanceMode } from '@/features/appearance/paint.ts'
import { useConsoleLayoutStore } from '@/stores/console-layout.ts'
import { useSessionStore } from '@/stores/session.ts'
import { findAuthToken, subscribeAuthToken } from '@/utils/auth.ts'

function findRoleLabel(role: string | undefined) {
  if (role?.toUpperCase() === 'ADMIN') return '管理员'
  return role || '管理员'
}

function findInitials(name: string | undefined) {
  if (!name) return '?'
  return name.slice(0, 1).toUpperCase()
}

function nextMode(mode: AppearanceMode): AppearanceMode {
  if (mode === 'system') return 'light'
  if (mode === 'light') return 'dark'
  return 'system'
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
  const pinnedNav = useConsoleLayoutStore(function (state) {
    return state.pinnedNav
  })
  const bookmarks = useConsoleLayoutStore(function (state) {
    return state.bookmarks
  })
  const appearanceMode = useConsoleLayoutStore(function (state) {
    return state.appearanceMode
  })
  const writeAppearance = useConsoleLayoutStore(function (state) {
    return state.writeAppearance
  })
  const [commandOpen, updateCommandOpen] = useState(false)
  const [shortcutOpen, updateShortcutOpen] = useState(false)
  const [signOutOpen, updateSignOutOpen] = useState(false)
  const [isGoArmed, updateGoArmed] = useState(false)

  const current = findNavItem(location.pathname)
  const activeGroup = current?.group ?? NAV_GROUPS[0]?.id
  const groupItems = NAV_ITEMS.filter(function (item) {
    return item.group === activeGroup
  })
  const isNested = Boolean(current && location.pathname !== current.path)

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
      paintAppearance(appearanceMode)
      if (appearanceMode !== 'system') return
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      function onChange() {
        paintAppearance('system')
      }
      media.addEventListener('change', onChange)
      return function () {
        media.removeEventListener('change', onChange)
      }
    },
    [appearanceMode]
  )

  useEffect(
    function () {
      function isTyping(target: EventTarget | null) {
        if (!(target instanceof HTMLElement)) return false
        const tag = target.tagName
        return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
      }

      function onKeyDown(event: KeyboardEvent) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          updateCommandOpen(true)
          updateGoArmed(false)
          return
        }
        if (isTyping(event.target)) return
        if (event.metaKey || event.ctrlKey || event.altKey) return

        if (event.key === '?' || (event.shiftKey && event.key === '/')) {
          event.preventDefault()
          updateShortcutOpen(true)
          updateGoArmed(false)
          return
        }

        if (event.key.toLowerCase() === 'd' && !isGoArmed) {
          event.preventDefault()
          writeAppearance(nextMode(useConsoleLayoutStore.getState().appearanceMode))
          return
        }

        if (event.key.toLowerCase() === 'g' && !event.repeat) {
          updateGoArmed(true)
          window.setTimeout(function () {
            updateGoArmed(false)
          }, 800)
          return
        }

        if (isGoArmed) {
          const item = NAV_ITEMS.find(function (nav) {
            return nav.key === event.key.toLowerCase()
          })
          updateGoArmed(false)
          if (item) {
            event.preventDefault()
            void navigate(item.path)
          }
        }
      }

      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
      }
    },
    [isGoArmed, navigate, writeAppearance]
  )

  const modeLabel =
    appearanceMode === 'dark' ? '深色' : appearanceMode === 'light' ? '浅色' : '跟随系统'

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <NavLink
          to="/overview"
          className="flex shrink-0 items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
            iT
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">cogito</span>
        </NavLink>

        <nav className="hidden min-w-0 items-center gap-1 md:flex">
          {NAV_GROUPS.map(function (group) {
            const first = NAV_ITEMS.find(function (item) {
              return item.group === group.id
            })
            if (!first) return null
            const isActive = group.id === activeGroup
            return (
              <NavLink
                key={group.id}
                to={first.path}
                className={clsx(
                  'rounded-md px-2.5 py-1.5 text-sm',
                  isActive
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}>
                {group.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1.5">
          {pinnedNav.length > 0 ? (
            <div className="hidden items-center gap-1 lg:flex">
              {pinnedNav.map(function (id) {
                const item = findNavById(id)
                if (!item) return null
                return (
                  <NavLink
                    key={id}
                    to={item.path}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          ) : null}

          <Button
            type="button"
            variant="outline"
            className="h-9 w-40 justify-start gap-2 px-3 text-muted-foreground sm:w-56"
            onClick={function () {
              updateCommandOpen(true)
            }}>
            <Icon
              icon="lucide:search"
              className="size-4 shrink-0"
            />
            <span className="min-w-0 flex-1 truncate text-left text-sm">跳转…</span>
            <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="书签"
                />
              }>
              <Icon
                icon="lucide:bookmark"
                className="size-4"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>书签</DropdownMenuLabel>
              </DropdownMenuGroup>
              {bookmarks.length === 0 ? (
                <DropdownMenuItem disabled>还没有收藏</DropdownMenuItem>
              ) : (
                bookmarks.map(function (bookmark) {
                  return (
                    <DropdownMenuItem
                      key={bookmark.id}
                      onClick={function () {
                        void navigate(bookmark.path)
                      }}>
                      {bookmark.label}
                    </DropdownMenuItem>
                  )
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`主题：${modeLabel}`}
            onClick={function () {
              writeAppearance(nextMode(appearanceMode))
            }}>
            {modeLabel}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 gap-2 px-2"
                  aria-label={user?.username ?? '账户'}
                />
              }>
              <Avatar className="size-7">
                {user?.avatarUrl ? (
                  <AvatarImage
                    src={user.avatarUrl}
                    alt={user.username}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-xs text-primary">
                  {findInitials(user?.username)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-24 truncate text-sm sm:inline">
                {user?.username ?? '未登录'}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{findRoleLabel(user?.role)}</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={function () {
                  updateShortcutOpen(true)
                }}>
                键盘快捷键
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={function () {
                  void navigate('/preferences')
                }}>
                偏好
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={function () {
                  updateSignOutOpen(true)
                }}>
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <nav className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto overscroll-x-contain border-b border-border px-4">
        {groupItems.map(function (item) {
          const isActive = current?.id === item.id
          return (
            <NavLink
              key={item.id}
              to={item.path}
              className={clsx(
                'shrink-0 rounded-md px-2.5 py-1 text-sm',
                isActive
                  ? 'font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}>
              {item.label}
            </NavLink>
          )
        })}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="ms-auto shrink-0 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:hidden">
            更多
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {NAV_GROUPS.map(function (group) {
              const first = NAV_ITEMS.find(function (item) {
                return item.group === group.id
              })
              if (!first) return null
              return (
                <DropdownMenuItem
                  key={group.id}
                  onClick={function () {
                    void navigate(first.path)
                  }}>
                  {group.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {isNested ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 text-sm text-muted-foreground">
          <span>{current?.group}</span>
          <span>/</span>
          <NavLink
            to={current?.path ?? '/overview'}
            className="hover:text-foreground">
            {current?.label}
          </NavLink>
          <span>/</span>
          <span className="truncate text-foreground">详情</span>
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full flex-col p-4">
          <Outlet />
        </div>
      </main>

      <CommandPalette
        open={commandOpen}
        onOpenChange={updateCommandOpen}
      />
      <ShortcutDialog
        open={shortcutOpen}
        onOpenChange={updateShortcutOpen}
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
  )
}

export { AppShell }
