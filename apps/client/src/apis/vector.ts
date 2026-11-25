/**
 * 向量索引（`vector_*`）与 wiki HTTP 配置接口。
 *
 * `vector_*` 是早期 `knowledge/vectorstore.rs` 的命令（Rust 侧按函数名注册，
 * 没走 `模块:方法` 的 rename），频道常量在 `CHANNELS.VECTOR` 里集中登记。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function POST_VECTOR_SEARCH<T>(params: Record<string, unknown>): Promise<T> {
  return invoke<T>(CHANNELS.VECTOR.SEARCH, params)
}

function POST_VECTOR_UPSERT(params: Record<string, unknown>): Promise<void> {
  return invoke(CHANNELS.VECTOR.UPSERT, params)
}

function DELETE_VECTOR(params: Record<string, unknown>): Promise<void> {
  return invoke(CHANNELS.VECTOR.DELETE, params)
}

function GET_VECTOR_COUNT(params: Record<string, unknown>): Promise<number> {
  return invoke<number>(CHANNELS.VECTOR.COUNT, params)
}

/** 清空整库向量索引 */
function DELETE_VECTOR_ALL(params: Record<string, unknown>): Promise<void> {
  return invoke(CHANNELS.VECTOR.CLEAR, params)
}

/** 下发 wiki 检索的 HTTP 配置（cogito-mcp 侧读） */
function POST_WIKI_HTTP_CONFIG(params: Record<string, unknown>): Promise<void> {
  return invoke(CHANNELS.WIKI.HTTP_CONFIGURE, params)
}

export {
  DELETE_VECTOR,
  DELETE_VECTOR_ALL,
  GET_VECTOR_COUNT,
  POST_VECTOR_SEARCH,
  POST_VECTOR_UPSERT,
  POST_WIKI_HTTP_CONFIG
}
