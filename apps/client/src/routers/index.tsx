import { lazy } from 'react'
import { Navigate, createBrowserRouter, useLocation, type RouteObject } from 'react-router-dom'
import { AppHost } from '@/features/magnetic-tile/host'
import { WorkspaceShell } from '@/features/magnetic-tile/workspace-shell'
import Overlay from '@/views/overlay/overlay'
import { RouteTransition } from '@/routers/transition.tsx'

/** agent 窗口的布局路由（出口）；聊天与设置是它的两个子页，互斥渲染 */
const Agent = lazy(function () {
  return import('@/views/agent/agent.tsx')
})

const AgentChat = lazy(function () {
  return import('@/views/agent/chat/chat.tsx')
})

const AgentSettings = lazy(function () {
  return import('@/views/agent/settings/settings.tsx')
})

/** `/agent` 重定向到默认子页，查询串随身带（磁贴记录上的 url 走 `?url=`） */
function AgentIndex() {
  const location = useLocation()
  return (
    <Navigate
      replace
      to={{ pathname: 'chat', search: location.search }}
    />
  )
}

/** `/overview` 路由占位：墙面由 WorkspaceShell Activity 渲染，此处只匹配 URL */
function OverviewRouteSlot() {
  return null
}

/** 磁贴窗口：每个组件一个路由，与 `views/<component>` 一一对应（见 activate.ts） */
const Bookmark = lazy(function () {
  return import('@/views/bookmark/bookmark.tsx')
})

const Calendar = lazy(function () {
  return import('@/views/calendar/calendar.tsx')
})

const Clipchamp = lazy(function () {
  return import('@/views/clipchamp/clipchamp.tsx')
})

const Clock = lazy(function () {
  return import('@/views/clock/clock.tsx')
})

const Code = lazy(function () {
  return import('@/views/code/code.tsx')
})

const Collection = lazy(function () {
  return import('@/views/collection/collection.tsx')
})

const Countdown = lazy(function () {
  return import('@/views/countdown/countdown.tsx')
})

const Developer = lazy(function () {
  return import('@/views/developer/developer.tsx')
})

const Directive = lazy(function () {
  return import('@/views/directive/directive.tsx')
})

const DirectiveLibraryPage = lazy(function () {
  return import('@/views/directive/directive.tsx').then(function (mod) {
    return { default: mod.DirectiveLibraryPage }
  })
})

const DirectiveWorkspacePage = lazy(function () {
  return import('@/views/directive/directive.tsx').then(function (mod) {
    return { default: mod.DirectiveWorkspacePage }
  })
})

const Example = lazy(function () {
  return import('@/views/example/example.tsx')
})

const Gallery = lazy(function () {
  return import('@/views/gallery/gallery.tsx')
})

const Capture = lazy(function () {
  return import('@/views/capture/capture.tsx')
})

const CaptureScreenshot = lazy(function () {
  return import('@/views/capture/screenshot/screenshot.tsx')
})

const CaptureRecording = lazy(function () {
  return import('@/views/capture/recording/recording.tsx')
})

const Markdown = lazy(function () {
  return import('@/views/markdown/markdown.tsx')
})

const Marketplace = lazy(function () {
  return import('@/views/marketplace/marketplace.tsx')
})

const Morph = lazy(function () {
  return import('@/views/morph/morph.tsx')
})

const Settings = lazy(function () {
  return import('@/views/settings/settings.tsx')
})

const Signboard = lazy(function () {
  return import('@/views/signboard/signboard.tsx')
})

/**
 * AppHost → WorkspaceShell（磁贴墙 Activity 常驻）→ RouteTransition（应用页转场）。
 * `/overview` 由 WorkspaceShell 渲染，outlet 只挂应用页，避免双挂 / 整墙 remount。
 */
const routes: RouteObject[] = [
  {
    element: <AppHost />,
    children: [
      {
        element: <WorkspaceShell />,
        children: [
          {
            element: <RouteTransition />,
            children: [
              {
                path: '/',
                element: (
                  <Navigate
                    replace
                    to={'/overview'}
                  />
                )
              },
              {
                path: '/overview',
                element: <OverviewRouteSlot />
              },
              {
                path: '/overlay',
                element: <Overlay />
              },
              {
                path: '/agent',
                element: <Agent />,
                children: [
                  { index: true, element: <AgentIndex /> },
                  { path: 'chat', element: <AgentChat /> },
                  { path: 'settings', element: <AgentSettings /> }
                ]
              },
              { path: '/bookmark', element: <Bookmark /> },
              { path: '/calendar', element: <Calendar /> },
              { path: '/clipchamp', element: <Clipchamp /> },
              { path: '/clock', element: <Clock /> },
              { path: '/code', element: <Code /> },
              { path: '/collection', element: <Collection /> },
              { path: '/countdown', element: <Countdown /> },
              { path: '/developer', element: <Developer /> },
              {
                path: '/directive',
                element: <Directive />,
                children: [
                  { index: true, element: <DirectiveLibraryPage /> },
                  { path: ':name', element: <DirectiveWorkspacePage /> }
                ]
              },
              { path: '/example', element: <Example /> },
              { path: '/gallery', element: <Gallery /> },
              {
                path: '/capture',
                element: <Capture />,
                children: [
                  { index: true, element: <CaptureScreenshot /> },
                  { path: 'recording', element: <CaptureRecording /> }
                ]
              },
              { path: '/markdown', element: <Markdown /> },
              { path: '/marketplace', element: <Marketplace /> },
              { path: '/morph', element: <Morph /> },
              { path: '/navigation', element: <Navigate replace to="/overview" /> },
              { path: '/settings', element: <Settings /> },
              { path: '/signboard', element: <Signboard /> }
            ]
          }
        ]
      }
    ]
  }
]

export const router = createBrowserRouter(routes)

export { routes }
