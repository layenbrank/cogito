/**
 * 浮层（`overlay:*`）接口：主窗侧控制幂等浮层（截图 / 灵动岛）的挂载、模式与内容上报。
 *
 * 浮层窗口自己读模式用 `GET_OVERLAY_MODE`；主窗写内容用 `POST_OVERLAY` / `PATCH_OVERLAY`。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function GET_OVERLAY<T>(): Promise<T> {
  return invoke<T>(CHANNELS.OVERLAY.READ)
}

function POST_OVERLAY<T>(item: unknown): Promise<T> {
  return invoke<T>(CHANNELS.OVERLAY.WRITE, { item })
}

function PATCH_OVERLAY(id: string, patch: unknown): Promise<void> {
  return invoke(CHANNELS.OVERLAY.UPDATE, { id, patch })
}

function DELETE_OVERLAY(ids: string[]): Promise<void> {
  return invoke(CHANNELS.OVERLAY.REMOVE, { ids })
}

function POST_OVERLAY_ENSURE(): Promise<void> {
  return invoke(CHANNELS.OVERLAY.ENSURE)
}

function POST_OVERLAY_HIDE(): Promise<void> {
  return invoke(CHANNELS.OVERLAY.HIDE)
}

function POST_OVERLAY_PARK(): Promise<void> {
  return invoke(CHANNELS.OVERLAY.PARK)
}

function POST_OVERLAY_PING(): Promise<void> {
  return invoke(CHANNELS.OVERLAY.PING)
}

function POST_OVERLAY_MODE(mode: string): Promise<void> {
  return invoke(CHANNELS.OVERLAY.UPDATE_MODE, { mode })
}

function GET_OVERLAY_MODE<T>(): Promise<T> {
  return invoke<T>(CHANNELS.OVERLAY.READ_MODE)
}

function POST_OVERLAY_MOUNT(params: Record<string, unknown>): Promise<void> {
  return invoke(CHANNELS.OVERLAY.MOUNT, params)
}

function POST_OVERLAY_UNMOUNT(params: Record<string, unknown>): Promise<void> {
  return invoke(CHANNELS.OVERLAY.UNMOUNT, params)
}

function GET_OVERLAY_PENDING_UNMOUNT<T>(): Promise<T> {
  return invoke<T>(CHANNELS.OVERLAY.TAKE_PENDING_UNMOUNT)
}

function POST_OVERLAY_CONTENT(hasContent: boolean): Promise<void> {
  return invoke(CHANNELS.OVERLAY.REPORT_CONTENT, { hasContent })
}

function POST_OVERLAY_CONCEALED(): Promise<void> {
  return invoke(CHANNELS.OVERLAY.CONCEALED)
}

export {
  DELETE_OVERLAY,
  GET_OVERLAY,
  GET_OVERLAY_MODE,
  GET_OVERLAY_PENDING_UNMOUNT,
  PATCH_OVERLAY,
  POST_OVERLAY,
  POST_OVERLAY_CONCEALED,
  POST_OVERLAY_CONTENT,
  POST_OVERLAY_ENSURE,
  POST_OVERLAY_HIDE,
  POST_OVERLAY_MODE,
  POST_OVERLAY_MOUNT,
  POST_OVERLAY_PARK,
  POST_OVERLAY_PING,
  POST_OVERLAY_UNMOUNT
}
