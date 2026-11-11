/**
 * 模型偏好：思考强度 / 显示 / 上下文窗口（agent.json）
 */

import { findPref, patchPref } from '@/features/persist'
import type { ModelPref, ThinkingLevel } from '@/features/persist'

/**
 * 档位文案的唯一来源：`label` 给胶囊（两个字塞得进五等分），`hint` 给下面那行小字，
 * 说清「多花这点思考换到什么」。选择器 / 右栏仪表 / 设置里的下拉都读这一份。
 */
const THINKING_OPTIONS: { value: ThinkingLevel; label: string; hint: string }[] = [
  { value: 'off', label: '关闭', hint: '直接回答，不额外思考' },
  { value: 'low', label: '快速', hint: '短思考，优先出结果' },
  { value: 'medium', label: '标准', hint: '日常默认，速度与质量兼顾' },
  { value: 'high', label: '深入', hint: '多步推演，难题更稳' },
  { value: 'max', label: '极致', hint: '尽量想透，最慢也最费 token' }
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

/**
 * 改单个模型的思考档位并落盘（整表写回，其他模型的项原样带回去）。
 * 模型选择器与右栏仪表共用这一处，避免两边各写一遍「展开-改-合并」。
 */
function writeModelThinking(providerID: string, model: string, thinking: ThinkingLevel) {
  const prefs = readModelPrefs()
  const key = findModelKey(providerID, model)
  writeModelPrefs({ ...prefs, [key]: { ...(prefs[key] ?? { ...MODEL_PREF }), thinking } })
}

function findModelPref(providerID: string, model: string, prefs?: Record<string, ModelPref>) {
  const map = prefs ?? readModelPrefs()
  return map[findModelKey(providerID, model)] ?? { ...MODEL_PREF }
}

/**
 * 是否给这个模型显示思考强度入口。
 *
 * 名字判断本身不可靠（新模型层出不穷），所以表里只列**已知的推理家族**：
 * 命中就给入口（Qoder 式的「可配」语义）；没命中的（如组织网关的 Auto）
 * 保持「不支持」，不凭空给一个调了也不生效的按钮。
 */
const THINKING_HINTS = [
  'o1',
  'o3',
  'o4',
  'r1',
  'qwq',
  'thinking',
  'reason',
  'deepseek',
  'qwen3',
  'glm',
  'claude',
  'sonnet',
  'opus',
  'gemini',
  'gpt-5',
  'grok',
  'kimi'
]

function canThink(model: string) {
  const name = model.toLowerCase()
  return THINKING_HINTS.some(function (hint) {
    return name.includes(hint)
  })
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
  writeModelPrefs,
  writeModelThinking
}
export type { ModelPref, ThinkingLevel }
