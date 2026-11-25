/**
 * 信息板（`signboard*:*`）接口：板 / 列 / 条目 / 条目附件 / 标签 / 打标 / 检查项 / 自动化。
 *
 * 八个命名空间共用同一套「键 + 变更」CRUD，所以每个资源固定四个接口；
 * 行类型由调用方给泛型（各资源的 `Signboard*` 形状定义在 store 侧）。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'


function GET_SIGNBOARDS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD.READ, { params })
}

function POST_SIGNBOARDS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD.WRITE, { params })
}

function PATCH_SIGNBOARDS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD.UPDATE, { params })
}

function DELETE_SIGNBOARDS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD.REMOVE, { params })
}

function GET_SIGNBOARD_COLUMNS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_COLUMN.READ, { params })
}

function POST_SIGNBOARD_COLUMNS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_COLUMN.WRITE, { params })
}

function PATCH_SIGNBOARD_COLUMNS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_COLUMN.UPDATE, { params })
}

function DELETE_SIGNBOARD_COLUMNS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_COLUMN.REMOVE, { params })
}

function GET_SIGNBOARD_ENTRIES<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_ENTRY.READ, { params })
}

function POST_SIGNBOARD_ENTRIES<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_ENTRY.WRITE, { params })
}

function PATCH_SIGNBOARD_ENTRIES<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_ENTRY.UPDATE, { params })
}

function DELETE_SIGNBOARD_ENTRIES<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_ENTRY.REMOVE, { params })
}

function GET_SIGNBOARD_ENTRY_ASSETS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_ENTRY_ASSET.READ, { params })
}

function POST_SIGNBOARD_ENTRY_ASSETS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_ENTRY_ASSET.WRITE, { params })
}

function PATCH_SIGNBOARD_ENTRY_ASSETS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_ENTRY_ASSET.UPDATE, { params })
}

function DELETE_SIGNBOARD_ENTRY_ASSETS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_ENTRY_ASSET.REMOVE, { params })
}

function GET_SIGNBOARD_TAGS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_TAG.READ, { params })
}

function POST_SIGNBOARD_TAGS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_TAG.WRITE, { params })
}

function PATCH_SIGNBOARD_TAGS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_TAG.UPDATE, { params })
}

function DELETE_SIGNBOARD_TAGS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_TAG.REMOVE, { params })
}

function GET_SIGNBOARD_TAGGED<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_TAGGED.READ, { params })
}

function POST_SIGNBOARD_TAGGED<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_TAGGED.WRITE, { params })
}

function DELETE_SIGNBOARD_TAGGED<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_TAGGED.REMOVE, { params })
}

function GET_SIGNBOARD_CHECKS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_CHECK.READ, { params })
}

function POST_SIGNBOARD_CHECKS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_CHECK.WRITE, { params })
}

function PATCH_SIGNBOARD_CHECKS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_CHECK.UPDATE, { params })
}

function DELETE_SIGNBOARD_CHECKS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_CHECK.REMOVE, { params })
}

function GET_SIGNBOARD_AUTOMATIONS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_AUTOMATION.READ, { params })
}

function POST_SIGNBOARD_AUTOMATIONS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_AUTOMATION.WRITE, { params })
}

function PATCH_SIGNBOARD_AUTOMATIONS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_AUTOMATION.UPDATE, { params })
}

function DELETE_SIGNBOARD_AUTOMATIONS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.SIGNBOARD_AUTOMATION.REMOVE, { params })
}

export {
  DELETE_SIGNBOARDS,
  DELETE_SIGNBOARD_AUTOMATIONS,
  DELETE_SIGNBOARD_CHECKS,
  DELETE_SIGNBOARD_COLUMNS,
  DELETE_SIGNBOARD_ENTRIES,
  DELETE_SIGNBOARD_ENTRY_ASSETS,
  DELETE_SIGNBOARD_TAGGED,
  DELETE_SIGNBOARD_TAGS,
  GET_SIGNBOARDS,
  GET_SIGNBOARD_AUTOMATIONS,
  GET_SIGNBOARD_CHECKS,
  GET_SIGNBOARD_COLUMNS,
  GET_SIGNBOARD_ENTRIES,
  GET_SIGNBOARD_ENTRY_ASSETS,
  GET_SIGNBOARD_TAGGED,
  GET_SIGNBOARD_TAGS,
  PATCH_SIGNBOARDS,
  PATCH_SIGNBOARD_AUTOMATIONS,
  PATCH_SIGNBOARD_CHECKS,
  PATCH_SIGNBOARD_COLUMNS,
  PATCH_SIGNBOARD_ENTRIES,
  PATCH_SIGNBOARD_ENTRY_ASSETS,
  PATCH_SIGNBOARD_TAGS,
  POST_SIGNBOARDS,
  POST_SIGNBOARD_AUTOMATIONS,
  POST_SIGNBOARD_CHECKS,
  POST_SIGNBOARD_COLUMNS,
  POST_SIGNBOARD_ENTRIES,
  POST_SIGNBOARD_ENTRY_ASSETS,
  POST_SIGNBOARD_TAGGED,
  POST_SIGNBOARD_TAGS
}