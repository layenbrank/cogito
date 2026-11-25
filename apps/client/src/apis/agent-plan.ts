/**
 * 会话档案（`agentPlan:*` / `agentGoal:*`）接口。
 *
 * 两者都是「一行一个会话」的整档读写：没有单字段 patch，写就是整条覆盖。
 */
import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

function GET_AGENT_PLANS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_PLAN.TO_READ, { params })
}

function POST_AGENT_PLAN<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_PLAN.TO_WRITE, { params })
}

function PATCH_AGENT_PLAN<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_PLAN.TO_UPDATE, { params })
}

function DELETE_AGENT_PLANS<T = string[]>(params: string[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_PLAN.TO_REMOVE, { params })
}

function GET_AGENT_GOALS<T>(params: unknown = {}): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_GOAL.TO_READ, { params })
}

function POST_AGENT_GOAL<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_GOAL.TO_WRITE, { params })
}

function PATCH_AGENT_GOAL<T = string[]>(params: unknown): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_GOAL.TO_UPDATE, { params })
}

function DELETE_AGENT_GOALS<T = string[]>(params: string[]): Promise<T> {
  return invoke<T>(CHANNELS.AGENT_GOAL.TO_REMOVE, { params })
}

export {
  DELETE_AGENT_GOALS,
  DELETE_AGENT_PLANS,
  GET_AGENT_GOALS,
  GET_AGENT_PLANS,
  PATCH_AGENT_GOAL,
  PATCH_AGENT_PLAN,
  POST_AGENT_GOAL,
  POST_AGENT_PLAN
}
