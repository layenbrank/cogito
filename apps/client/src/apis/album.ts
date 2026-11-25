/**
 * 相册（`album:*`）与素材（`asset:*`）接口。
 *
 * `asset` 是截图 / 图库共用的素材表；`album` 只存名称与排序，成员关系靠素材行的 `albumID`。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'


// ------------------------------------------------------------ 相册

function GET_ALBUMS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.ALBUM.READ, { params })
}

function POST_ALBUMS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.ALBUM.WRITE, { params })
}

function PATCH_ALBUMS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.ALBUM.UPDATE, { params })
}

function DELETE_ALBUMS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.ALBUM.REMOVE, { params })
}

// ------------------------------------------------------------ 素材

function GET_ASSETS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.ASSET.READ, { params })
}

function POST_ASSETS<T = { id: string }[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.ASSET.INSERT, { params })
}

function PATCH_ASSETS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.ASSET.UPDATE, { params })
}

function DELETE_ASSETS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.ASSET.REMOVE, { params })
}

export {
  DELETE_ALBUMS,
  DELETE_ASSETS,
  GET_ALBUMS,
  GET_ASSETS,
  PATCH_ALBUMS,
  PATCH_ASSETS,
  POST_ALBUMS,
  POST_ASSETS
}