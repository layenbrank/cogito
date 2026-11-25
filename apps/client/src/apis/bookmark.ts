/**
 * 书签（`bookmark:*`）接口：本地索引表 + 浏览器书签导入。
 *
 * 导入是单次事务（Rust 侧一次写完并把并发冲突挡在库里），`POST_BOOKMARK_IMPORT` 只触发。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function GET_BOOKMARKS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.BOOKMARK.READ, { params })
}

function POST_BOOKMARKS<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.BOOKMARK.WRITE, { params })
}

function PATCH_BOOKMARKS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.BOOKMARK.UPDATE, { params })
}

function DELETE_BOOKMARKS<T = void>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.BOOKMARK.REMOVE, { params })
}

function POST_BOOKMARK_IMPORT<T>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.BOOKMARK.IMPORT, { params })
}

export { DELETE_BOOKMARKS, GET_BOOKMARKS, PATCH_BOOKMARKS, POST_BOOKMARKS, POST_BOOKMARK_IMPORT }
