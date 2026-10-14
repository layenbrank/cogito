import React from 'react'
import { Navigate, createHashRouter, type RouteObject } from 'react-router-dom'

import { RouteTransition } from './transition.tsx'

type RouteModule = {
  default: RouteObject | RouteObject[]
}

/** 排除测试文件：这个 glob 在构建期捞文件，被捞到的东西会真的进生产包（vitest 也会跟着进去） */
const modules: Record<string, RouteModule> = import.meta.glob(
  ['./routes/**/*.{ts,tsx}', '!**/*.test.{ts,tsx}'],
  { eager: true }
)

/**
 * 各页面挂在同一个**无路径布局路由**下：切页面（如 `/agent` ↔ `/agent/settings`）统一走转场，
 * 新增路由不用各自处理动效（见 `transition.tsx`）。
 */
const routes: RouteObject[] = [
  {
    element: React.createElement(RouteTransition),
    children: [
      {
        path: '/',
        element: React.createElement(Navigate, {
          replace: true,
          to: '/overview'
        })
      }
    ]
  }
]

for (const module of Object.values(modules)) {
  if (!module?.default) continue
  const defined = module.default
  if (Array.isArray(defined)) routes.push(...defined)
  else routes.push(defined)
}

/** 打包为 file:// 时 Browser history 无法匹配路径，必须用 Hash */
const router = createHashRouter(routes)

export { router, routes }
