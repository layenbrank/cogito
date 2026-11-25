/**
 * 系统级（`system:*` / `through:*` / `autostart:*`）接口。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

// ------------------------------------------------------------ 系统

function GET_SYSTEM_OS<T>(): Promise<T> {
  return invoke<T>(CHANNELS.SYSTEM.OS)
}

/** 应用代理设置（Rust 侧写入并热更所有 HTTP 客户端） */
function PATCH_SYSTEM_PROXY(config: unknown): Promise<void> {
  return invoke(CHANNELS.SYSTEM.PROXY_APPLY, { config })
}

// ------------------------------------------------------------ 穿透区

function POST_THROUGH_RECTS(source: string, rects: unknown): Promise<void> {
  return invoke(CHANNELS.THROUGH.UPDATE_RECTS, { source, rects })
}

// ------------------------------------------------------------ 开机自启

function GET_AUTOSTART(): Promise<boolean> {
  return invoke<boolean>(CHANNELS.AUTOSTART.READ)
}

function PUT_AUTOSTART(desired: boolean): Promise<boolean> {
  return invoke<boolean>(CHANNELS.AUTOSTART.UPDATE, { enabled: desired })
}

export { GET_AUTOSTART, GET_SYSTEM_OS, PATCH_SYSTEM_PROXY, POST_THROUGH_RECTS, PUT_AUTOSTART }
