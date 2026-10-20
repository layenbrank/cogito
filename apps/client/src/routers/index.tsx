import { lazy, Suspense } from 'react'
import { Navigate, createBrowserRouter, useLocation, type RouteObject } from 'react-router-dom'
import { AppHost } from '@/features/magnetic-tile/host'
import Overlay from '@/views/overlay/overlay'
import { RouteTransition } from '@/routers/transition.tsx'

const Overview = lazy(function () {
  return import('@/views/overview/overview.tsx')
})

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

const NavigationBar = lazy(function () {
  return import('@/views/navigation/bar.tsx').then(function (mod) {
    return { default: mod.NavigationBar }
  })
})

const Settings = lazy(function () {
  return import('@/views/settings/settings.tsx')
})

const Signboard = lazy(function () {
  return import('@/views/signboard/signboard.tsx')
})

/**
 * 各页面挂在同一个**无路径布局路由**下：切页面统一走转场（见 `transition.tsx`），
 * 新增路由不用各自处理动效。
 */
const routes: RouteObject[] = [
  {
    path: '/navigation/bar',
    element: (
      <Suspense fallback={null}>
        <NavigationBar />
      </Suspense>
    )
  },
  {
    element: <AppHost />,
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
        element: <Overview />
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

export const router = createBrowserRouter(routes)

export { routes }
