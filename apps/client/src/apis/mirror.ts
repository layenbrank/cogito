/**
 * 镜像（`mirror:*`）与磁贴（`magnetic-tile:*`）接口。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'


// ------------------------------------------------------------ 镜像

function GET_MIRRORS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.MIRROR.READ, { params })
}

function POST_MIRRORS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MIRROR.WRITE, { params })
}

function PATCH_MIRRORS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MIRROR.UPDATE, { params })
}

function DELETE_MIRRORS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MIRROR.REMOVE, { params })
}

// ------------------------------------------------------------ 磁贴

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

export {
  DELETE_MAGNETIC_TILES,
  DELETE_MIRRORS,
  GET_MAGNETIC_TILES,
  GET_MIRRORS,
  PATCH_MAGNETIC_TILES,
  PATCH_MIRRORS,
  POST_MAGNETIC_TILES,
  POST_MIRRORS
}