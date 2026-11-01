import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { hasRunningThreads } from '@/features/agent/acp/run-state'
import {
  bindSessionHome,
  findAppComponent,
  hydrateSessionsFromPrefs,
  isMainWindow,
  parkSessions,
  rememberRoute
} from '@/features/magnetic-tile/session'
import { ensurePersist, ensureSecrets, findPref } from '@/features/persist'
import { adoptAppearance, APPEARANCE_SYNC, type Appearance } from '@/features/window/appearance'
import { EVENTS } from '@/shared/ipc/channels'
import { useMirrorStore } from '@/stores/mirror.ts'
import { useSettingsStore } from '@/stores/setting.ts'
import { syncCliMatches } from '@/utils/cli'
import { checkUpdate } from '@/utils/updater'

function isAgentPath(pathname: string): boolean {
  return pathname === '/agent' || pathname.startsWith('/agent/')
}

/**
 * 主窗口常驻壳：会话名单、外观同步。
 * 磁贴墙由 WorkspaceShell Activity 保活；应用页仍随路由卸挂。
 * 这些监听挂在壳上，不跟单页一起走。
 */
function AppHost() {
  const navigate = useNavigate()
  const location = useLocation()
  const wasAgentPath = useRef<boolean | null>(null)

  useEffect(
    function () {
      if (!isMainWindow()) return
      return bindSessionHome(function () {
        void navigate('/overview')
      })
    },
    [navigate]
  )

  useEffect(
    function () {
      if (!isMainWindow()) return
      const onAgent = isAgentPath(location.pathname)
      // 离开 Agent 且仍有回合在跑：提示后台继续（不 abort）
      const wasOnAgent = wasAgentPath.current
      if (wasOnAgent && !onAgent && hasRunningThreads()) {
        toast.message('Agent 会话仍在后台运行', {
          description: '回到 Agent 后会自动接上进度'
        })
      }
      wasAgentPath.current = onAgent

      const component = findAppComponent(location.pathname)
      if (!component) {
        parkSessions()
        return
      }
      rememberRoute(component, `${location.pathname}${location.search}`)
    },
    [location.pathname, location.search]
  )

  useEffect(function () {
    if (!isMainWindow()) return
    async function bootstrap() {
      await ensurePersist()
      await ensureSecrets()
      adoptAppearance(findPref('window').appearance)
      hydrateSessionsFromPrefs()
      await useMirrorStore.getState().toInitialize()
      await useSettingsStore.getState().toInitialize()
    }
    void bootstrap().catch(function (error: unknown) {
      console.warn('[tile-host] 主窗 bootstrap 失败', error)
    })
    void syncCliMatches().catch(function (error: unknown) {
      console.warn('[tile-host] 同步 CLI 失败', error)
    })
  }, [])

  useEffect(function () {
    if (!isMainWindow()) return
    let unlisten: (() => void) | undefined
    let cancelled = false

    void listen<string>(EVENTS.TRAY_ACTION, function (event) {
      if (event.payload === 'check-update') void checkUpdate()
    })
      .then(function (stop) {
        if (cancelled) stop()
        else unlisten = stop
      })
      .catch(function (error: unknown) {
        console.warn('[tile-host] 托盘监听失败', error)
      })

    return function () {
      cancelled = true
      unlisten?.()
    }
  }, [])

  useEffect(function () {
    if (!isMainWindow()) return
    let unlisten: (() => void) | undefined
    let cancelled = false

    void listen<Appearance>(APPEARANCE_SYNC, function (event) {
      adoptAppearance(event.payload)
    })
      .then(function (stop) {
        if (cancelled) stop()
        else unlisten = stop
      })
      .catch(function (error: unknown) {
        console.warn('[tile-host] 外观监听失败', error)
      })

    return function () {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return <Outlet />
}

export { AppHost }
