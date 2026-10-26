import { getCurrentWindow } from '@tauri-apps/api/window'

import { isMagneticTileComponent } from '@/constants/magnetic-tile/components'
import {
  findTileSessions,
  persistTileSessions,
  type TileSessionPref
} from '@/features/magnetic-tile/tile-prefs'
import { useKnowledgeStore } from '@/stores/knowledge'

/**
 * 主窗口里的磁贴会话。
 *
 * 同一组件只留一条（store 是单例）。名单只记 path，不复制应用界面：
 * 切走路由仍卸掉对应应用页。磁贴墙由 WorkspaceShell + Activity 常驻，
 * 与名单无关。后台超过上限只从名单拿掉，不清 store。笔记还脏着时留在名单里。
 */

interface TileSession {
  component: MagneticTile.Component
  tileId: string
  url: string
  path: string
}

interface SessionInput {
  component: MagneticTile.Component
  id: string
  url: string
  path: string
}

const MAIN_WINDOW_LABEL = 'main'
const MAIN_WINDOW_TITLE = 'cogito'
const BACKGROUND_CAP = 3

let sessions: readonly TileSession[] = []
const listeners = new Set<() => void>()
let goHome: (() => void) | null = null

function isMainWindow() {
  if (typeof window === 'undefined') return false
  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window
  if (!isTauri) return true
  try {
    return getCurrentWindow().label === MAIN_WINDOW_LABEL
  } catch (error) {
    console.warn('[tile-session] 读不到当前窗口', error)
    return true
  }
}

function findAppComponent(pathname: string): MagneticTile.Component | null {
  const segment = pathname.split('/').filter(Boolean)[0] ?? ''
  if (segment === 'overview' || segment === 'overlay' || segment === 'navigation') return null
  if (!isMagneticTileComponent(segment)) return null
  return segment
}

function isKnowledgeDirty() {
  return useKnowledgeStore.getState().isDirty
}

function publish() {
  for (const listener of listeners) listener()
  const snapshot: TileSessionPref[] = sessions.map(function (session) {
    return {
      component: session.component,
      tileId: session.tileId,
      url: session.url,
      path: session.path
    }
  })
  void persistTileSessions(snapshot)
}

/** 启动时从 tiles.json 灌回会话名单 */
function hydrateSessionsFromPrefs() {
  const stored = findTileSessions()
  if (stored.length === 0) return
  sessions = stored.map(function (session) {
    return {
      component: session.component,
      tileId: session.tileId,
      url: session.url,
      path: session.path
    }
  })
  for (const listener of listeners) listener()
}

function trimSessions(
  current: readonly TileSession[],
  foreground: MagneticTile.Component | null,
  isDirty: boolean
): TileSession[] {
  const front = foreground
    ? current.filter(function (session) {
        return session.component === foreground
      })
    : []
  const background = current.filter(function (session) {
    return session.component !== foreground
  })
  const kept = background.slice(0, BACKGROUND_CAP)
  const overflow = background.slice(BACKGROUND_CAP)
  for (const session of overflow) {
    if (session.component === 'knowledge' && isDirty) kept.push(session)
  }
  return [...front, ...kept]
}

function admitSession(input: SessionInput) {
  const next: TileSession = {
    component: input.component,
    tileId: input.id,
    url: input.url,
    path: input.path
  }
  const rest = sessions.filter(function (session) {
    return session.component !== input.component
  })
  sessions = trimSessions([next, ...rest], input.component, isKnowledgeDirty())
  publish()
}

function rememberRoute(component: MagneticTile.Component, path: string) {
  const existing = sessions.find(function (session) {
    return session.component === component
  })
  if (!existing) {
    const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
    const url = new URLSearchParams(query).get('url') ?? ''
    admitSession({ component, id: component, url, path })
    return
  }
  if (existing.path === path && sessions[0]?.component === component) return
  const updated = { ...existing, path }
  const rest = sessions.filter(function (session) {
    return session.component !== component
  })
  sessions = [updated, ...rest]
  publish()
}

function parkSessions() {
  const next = trimSessions(sessions, null, isKnowledgeDirty())
  if (next.length === sessions.length) return
  sessions = next
  publish()
}

function dismissSession(component: MagneticTile.Component) {
  const next = sessions.filter(function (session) {
    return session.component !== component
  })
  if (next.length === sessions.length) return
  sessions = next
  publish()
}

function bindSessionHome(next: () => void) {
  goHome = next
  return function () {
    if (goHome === next) goHome = null
  }
}

/** 结束当前应用会话并回主页。独立旧窗口仍关闭自己。 */
function leaveTileSession() {
  if (!isMainWindow()) {
    void getCurrentWindow().close()
    return
  }
  const component = findAppComponent(window.location.pathname)
  if (component) dismissSession(component)
  goHome?.()
}

function readSessions() {
  return sessions
}

function subscribeSessions(listener: () => void) {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

export {
  BACKGROUND_CAP,
  MAIN_WINDOW_TITLE,
  admitSession,
  bindSessionHome,
  dismissSession,
  findAppComponent,
  hydrateSessionsFromPrefs,
  isMainWindow,
  leaveTileSession,
  parkSessions,
  readSessions,
  rememberRoute,
  subscribeSessions,
  trimSessions
}
export type { TileSession }
