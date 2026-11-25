/**
 * 磁贴（`magnetic-tile:*`）：墙上磁贴都落在本机 SQLite，索引由 Rust 侧分配
 * （`POST_MAGNETIC_TILES` 不传 index）。
 *
 * 这里**只依赖 Tauri IPC**：磁贴墙的高频路径（拖拽、预览缓存）不该被 HTTP 客户端
 * 的模块图拖累。将来要接云端同步快照，另开一个 `magnetic-tile-cloud.ts`。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function GET_MAGNETIC_TILES<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.MAGNETIC_TILE.READ, { params })
}

function POST_MAGNETIC_TILES<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MAGNETIC_TILE.WRITE, { params })
}

function PATCH_MAGNETIC_TILES<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MAGNETIC_TILE.UPDATE, { params })
}

function DELETE_MAGNETIC_TILES<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MAGNETIC_TILE.REMOVE, { params })
}

export { DELETE_MAGNETIC_TILES, GET_MAGNETIC_TILES, PATCH_MAGNETIC_TILES, POST_MAGNETIC_TILES }
