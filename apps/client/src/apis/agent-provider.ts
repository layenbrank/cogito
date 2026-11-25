/**
 * 模型接入（`agentProvider:*`）与用量账本（`agentUsage:*`）接口。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

// ------------------------------------------------------------ 接入

function GET_AGENT_PROVIDERS<T>(params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_PROVIDER.TO_READ, { params })
}

function POST_AGENT_PROVIDERS<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_PROVIDER.TO_WRITE, { params })
}

function PATCH_AGENT_PROVIDERS<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_PROVIDER.TO_UPDATE, { params })
}

function DELETE_AGENT_PROVIDERS<T = void>(params: string[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_PROVIDER.TO_REMOVE, { params })
}

// ------------------------------------------------------------ 用量

function GET_AGENT_USAGES<T>(params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_USAGE.TO_READ, { params })
}

function POST_AGENT_USAGES<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_USAGE.TO_WRITE, { params })
}

function PATCH_AGENT_USAGES<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_USAGE.TO_UPDATE, { params })
}

function DELETE_AGENT_USAGES<T = void>(params: string[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_USAGE.TO_REMOVE, { params })
}

export {
  DELETE_AGENT_PROVIDERS,
  DELETE_AGENT_USAGES,
  GET_AGENT_PROVIDERS,
  GET_AGENT_USAGES,
  PATCH_AGENT_PROVIDERS,
  PATCH_AGENT_USAGES,
  POST_AGENT_PROVIDERS,
  POST_AGENT_USAGES
}
