import React, { lazy } from 'react'
import { createHashRouter, Navigate, type RouteObject } from 'react-router-dom'

import { Frame } from '@/features/shell/frame.tsx'

/**
 * 新标签页路由。弹窗和侧栏是独立入口，不走这里。
 */

const Overview = lazy(function () {
  return import('@/views/overview/overview.tsx')
})

const Bookmarks = lazy(function () {
  return import('@/views/bookmark/bookmark.tsx')
})

const Settings = lazy(function () {
  return import('@/views/settings/settings.tsx')
})

const Collection = lazy(function () {
  return import('@/views/collection/collection.tsx')
})

const Marketplace = lazy(function () {
  return import('@/views/marketplace/marketplace.tsx')
})

const Calendar = lazy(function () {
  return import('@/views/calendar/calendar.tsx')
})

const Clock = lazy(function () {
  return import('@/views/clock/clock.tsx')
})

const Countdown = lazy(function () {
  return import('@/views/countdown/countdown.tsx')
})

const Wallpaper = lazy(function () {
  return import('@/views/wallpaper/wallpaper.tsx')
})

const Gallery = lazy(function () {
  return import('@/views/gallery/gallery.tsx')
})

const AgentChat = lazy(function () {
  return import('@/views/agent/chat/chat.tsx')
})

const NotFound = lazy(function () {
  return import('@/views/not-found.tsx')
})

const routes: RouteObject[] = [
  // 对话页不套镜像外壳：它要独占视口（与 client 的 /agent 同级，而不是嵌在磁贴里）
  {
    path: '/agent/chat',
    element: React.createElement(AgentChat)
  },
  {
    path: '/',
    element: React.createElement(Frame),
    children: [
      {
        index: true,
        element: (
          <Navigate
            replace
            to="/overview"
          />
        )
      },
      {
        path: 'overview',
        element: React.createElement(Overview)
      },
      {
        path: 'bookmarks',
        element: React.createElement(Bookmarks)
      },
      {
        path: 'settings',
        element: React.createElement(Settings)
      },
      {
        path: 'collection/:id',
        element: React.createElement(Collection)
      },
      {
        path: 'marketplace',
        element: React.createElement(Marketplace)
      },
      {
        path: 'calendar',
        element: React.createElement(Calendar)
      },
      {
        path: 'clock',
        element: React.createElement(Clock)
      },
      {
        path: 'countdown',
        element: React.createElement(Countdown)
      },
      {
        path: 'wallpaper',
        element: React.createElement(Wallpaper)
      },
      {
        path: 'gallery',
        element: React.createElement(Gallery)
      },
      {
        path: '*',
        element: React.createElement(NotFound)
      }
    ]
  }
]

export function buildReactRouter() {
  return createHashRouter(routes)
}
