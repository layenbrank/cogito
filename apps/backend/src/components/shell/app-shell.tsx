import { Button } from '@i-thinking/design/components/button'
import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { SortableNav } from '@/components/shell/sortable-nav.tsx'
import { useConsoleLayoutStore } from '@/stores/console-layout.ts'
import { useSessionStore } from '@/stores/session.ts'

function AppShell() {
  const navigate = useNavigate()
  const user = useSessionStore(function (state) {
    return state.user
  })
  const toSignOut = useSessionStore(function (state) {
    return state.toSignOut
  })
  const hydrateFromServer = useConsoleLayoutStore(function (state) {
    return state.hydrateFromServer
  })

  useEffect(function () {
    void hydrateFromServer()
  }, [hydrateFromServer])

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col bg-[var(--backend-rail)] text-[var(--backend-rail-fg)]">
        <div className="px-4 py-5">
          <p className="text-xs tracking-[0.18em] text-[var(--backend-rail-muted)] uppercase">
            i-thinking
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Backend</h1>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <SortableNav />
        </div>
        <div className="border-t border-white/10 px-3 py-3">
          <p className="truncate px-1 text-xs text-[var(--backend-rail-muted)]">
            {user?.username ?? '—'}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start text-[var(--backend-rail-muted)] hover:bg-white/5 hover:text-[var(--backend-rail-fg)]"
            onClick={function () {
              toSignOut()
              void navigate('/signin', { replace: true })
            }}>
            退出登录
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto bg-[var(--backend-shell)]">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export { AppShell }
