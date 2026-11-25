/**
 * 工作区（`agentWorkspace:*`）与工作区目录（`agentWorkspaceFolder:*`）接口。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function GET_AGENT_WORKSPACES<T>(params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_WORKSPACE.TO_READ, { params })
}

function POST_AGENT_WORKSPACES<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_WORKSPACE.TO_WRITE, { params })
}

function PATCH_AGENT_WORKSPACES<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_WORKSPACE.TO_UPDATE, { params })
}

function DELETE_AGENT_WORKSPACES<T = void>(params: string[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_WORKSPACE.TO_REMOVE, { params })
}

function GET_AGENT_WORKSPACE_FOLDERS<T>(params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_READ, { params })
}

function POST_AGENT_WORKSPACE_FOLDERS<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_WRITE, { params })
}

function PATCH_AGENT_WORKSPACE_FOLDERS<T = void>(params: unknown[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_UPDATE, { params })
}

function DELETE_AGENT_WORKSPACE_FOLDERS<T = void>(params: string[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_WORKSPACE_FOLDER.TO_REMOVE, { params })
}

export {
  DELETE_AGENT_WORKSPACES,
  DELETE_AGENT_WORKSPACE_FOLDERS,
  GET_AGENT_WORKSPACES,
  GET_AGENT_WORKSPACE_FOLDERS,
  PATCH_AGENT_WORKSPACES,
  PATCH_AGENT_WORKSPACE_FOLDERS,
  POST_AGENT_WORKSPACES,
  POST_AGENT_WORKSPACE_FOLDERS
}
