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
  return import('@/views/bookmarks/bookmarks.tsx')
})

const Settings = lazy(function () {
  return import('@/views/settings/settings.tsx')
})

const Collection = lazy(function () {
  return import('@/views/collection/collection.tsx')
})

const NotFound = lazy(function () {
  return import('@/views/not-found.tsx')
})

const routes: RouteObject[] = [
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
        path: '*',
        element: React.createElement(NotFound)
      }
    ]
  }
]

export function buildReactRouter() {
  return createHashRouter(routes)
}
