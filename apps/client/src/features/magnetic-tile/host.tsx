import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import {
  bindSessionHome,
  findAppComponent,
  isMainWindow,
  parkSessions,
  rememberRoute
} from '@/features/magnetic-tile/session'
import { adoptAppearance, APPEARANCE_SYNC, type Appearance } from '@/features/window/appearance'
import { EVENTS } from '@/shared/ipc/channels'
import { useMirrorStore } from '@/stores/mirror.ts'
import { useSettingsStore } from '@/stores/setting.ts'
import { applyCliMatches } from '@/utils/cli'
import { checkUpdate } from '@/utils/updater'

/**
 * 主窗口常驻壳：会话名单、外观同步。
 * 磁贴墙由 WorkspaceShell Activity 保活；应用页仍随路由卸挂。
 * 这些监听挂在壳上，不跟单页一起走。
 */
function AppHost() {
  const navigate = useNavigate()
  const location = useLocation()

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
      await useMirrorStore.getState().toInitialize()
      await useSettingsStore.getState().toInitialize()
    }
    void bootstrap()
    void applyCliMatches()
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
