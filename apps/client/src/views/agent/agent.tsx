/**
 * Agent 窗口入口（布局路由）：聊天与设置都是它的子页面，互斥渲染。
 *
 * 与 studio 的 `/agent` 同形 —— URL 只有 `/agent/chat`（默认）与 `/agent/settings`，
 * `/agent` 自己重定向到 `chat`（见 `routers/index.tsx`）；目录与路由同形，
 * 两个子页分别是 `views/agent/chat/`（三栏工作台）与 `views/agent/settings/`（模型接入）。
 * 窗口标题栏由子页各自渲染（`AgentTitlebar`），本文件只做全局设置初始化。
 */
import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'

import { useSettingsStore } from '@/stores/setting.ts'

export default function AgentView() {
  useEffect(function () {
    void useSettingsStore.getState().toInitialize()
  }, [])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <Outlet />
    </div>
  )
}
