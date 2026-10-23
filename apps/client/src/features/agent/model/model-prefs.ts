/**
 * 模型偏好：思考强度 / 显示 / 上下文窗口（agent.json）
 */

import { findPref, patchPref } from '@/features/persist'
import type { ModelPref, ThinkingLevel } from '@/features/persist'

const THINKING_OPTIONS: { value: ThinkingLevel; label: string }[] = [
  { value: 'off', label: '关闭思考' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '极高' }
]

/** 滑块等距刻度（视觉均分，非按 token 线性） */
const CONTEXT_STEPS = [128_000, 200_000, 400_000, 1_000_000] as const

const CONTEXT_INDEX_MARKS: Record<number, string> = {
  0: '128K',
  1: '200K',
  2: '400K',
  3: '1M'
}

const MODEL_PREF: ModelPref = {
  visible: true,
  thinking: 'medium',
  contextWindow: 128_000
}

function findModelKey(providerID: string, model: string) {
  return `${providerID}::${model}`
}

function readModelPrefs(): Record<string, ModelPref> {
  return findPref('agent').modelPrefs
}

function writeModelPrefs(prefs: Record<string, ModelPref>) {
  void patchPref('agent', { modelPrefs: prefs })
}

function findModelPref(providerID: string, model: string, prefs?: Record<string, ModelPref>) {
  const map = prefs ?? readModelPrefs()
  return map[findModelKey(providerID, model)] ?? { ...MODEL_PREF }
}

function canThink(model: string) {
  const name = model.toLowerCase()
  return (
    name.includes('o1') ||
    name.includes('o3') ||
    name.includes('o4') ||
    name.includes('r1') ||
    name.includes('thinking') ||
    name.includes('reason') ||
    name.includes('qwq')
  )
}

function findNearestContext(value: number) {
  let nearest: (typeof CONTEXT_STEPS)[number] = CONTEXT_STEPS[0]
  let best = Math.abs(value - nearest)
  for (const step of CONTEXT_STEPS) {
    const distance = Math.abs(value - step)
    if (distance < best) {
      best = distance
      nearest = step
    }
  }
  return nearest
}

function findContextIndex(value: number) {
  const nearest = findNearestContext(value)
  const index = CONTEXT_STEPS.indexOf(nearest)
  return index < 0 ? 0 : index
}

function findContextByIndex(index: number) {
  const clamped = Math.max(0, Math.min(CONTEXT_STEPS.length - 1, Math.round(index)))
  return CONTEXT_STEPS[clamped]
}

export {
  canThink,
  CONTEXT_INDEX_MARKS,
  CONTEXT_STEPS,
  findContextByIndex,
  findContextIndex,
  findModelKey,
  findModelPref,
  findNearestContext,
  MODEL_PREF,
  readModelPrefs,
  THINKING_OPTIONS,
  writeModelPrefs
}
export type { ModelPref, ThinkingLevel }
