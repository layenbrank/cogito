/**
 * 模型偏好：思考强度 / 显示 / 上下文窗口（agent.json）
 */

import { useSyncExternalStore } from 'react'

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

function writeModelPrefs(prefs: Record<string, ModelPref>): Promise<void> {
  return patchPref('agent', { modelPrefs: prefs }).then(function () {
    // 落盘之后广播：读偏好的那几处（composer / 右栏 / 设置）一起重渲染
    emitModelPrefs()
  })
}

/**
 * 改单个模型的思考档位并落盘（整表写回，其他模型的项原样带回去）。
 *
 * 三个入口共用这一处：模型选择器、右栏仪表、composer 浮层。
 * 返回 Promise 不只为「写完了」—— `applyGooseThinking` 读的是内存里的偏好，
 * 调用方必须等这次写入进了 cache 再下发，否则推给 goose 的还是**上一档**：
 * 界面写着「深入」、模型收到的却是「标准」，这种错位最难查。
 */
function writeModelThinking(
  providerID: string,
  model: string,
  thinking: ThinkingLevel
): Promise<void> {
  const prefs = readModelPrefs()
  const key = findModelKey(providerID, model)
  return writeModelPrefs({ ...prefs, [key]: { ...(prefs[key] ?? { ...MODEL_PREF }), thinking } })
}

function findModelPref(providerID: string, model: string, prefs?: Record<string, ModelPref>) {
  const map = prefs ?? readModelPrefs()
  return map[findModelKey(providerID, model)] ?? { ...MODEL_PREF }
}

/**
 * 思考档位是**跨组件共享**的状态：composer 浮层、右栏仪表、设置弹窗改的都是同一份。
 *
 * 但 `findPref` 只是内存 cache 的普通读函数，没有订阅 —— 一处写完，另一处不会重渲染，
 * 于是「composer 里选了深入，右栏还写着标准」。这里补一个极小的广播：写偏好时 emit，
 * 读偏好的组件用 `useModelThinking` 订阅，两边永远同一份值。
 */
const listeners = new Set<() => void>()

function subscribeModelPrefs(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function emitModelPrefs(): void {
  listeners.forEach(function (listener) {
    try {
      listener()
    } catch (error) {
      console.warn('[model-prefs] 订阅回调抛错:', error)
    }
  })
}

/**
 * 订阅某个模型的思考档位。
 *
 * `getSnapshot` 返回字符串（primitive），`useSyncExternalStore` 按值比较即可，
 * 不会因为 `findPref` 每次 `structuredClone` 出新对象而无限重渲染。
 */
function useModelThinking(providerID: string, model: string): ThinkingLevel {
  function snapshot() {
    return findModelPref(providerID, model).thinking
  }
  return useSyncExternalStore(subscribeModelPrefs, snapshot, snapshot)
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
  subscribeModelPrefs,
  THINKING_OPTIONS,
  useModelThinking,
  writeModelPrefs,
  writeModelThinking
}
export type { ModelPref, ThinkingLevel }
