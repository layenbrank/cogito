/**
 * 局部键派发器（窗口内 DOM）。
 *
 * 结构上比旧的 `keycodes/dispatcher.ts` 简单：**它自己不再维护注册表** —— 处理器链已经在
 * `keyboard/commands.ts` 里了。这里只做三件事：
 * 1. 单个 `window keydown` 监听（每个窗口一份，main / overlay 是不同 JS 上下文天然隔离）；
 * 2. 把事件匹配到键位表里的候选（窗口、上下文、输入框策略、作用域具体度）；
 * 3. 按具体度依次 `runCommand`，命中即止。
 *
 * **硬约束：`scope: 'global'` 的键位永不在这里匹配。** 它们由 OS 注册、由 `keyboard/global.ts`
 * 回调派发；若 DOM 也认，前台按下会双触发。
 */

import { getCurrentWindow } from '@tauri-apps/api/window'

import { isBrowserWindow } from '@/features/window/kind'
import { isModifierEvent, matchesEventText } from '@/keyboard/binding'
import { hasCommand, runCommand } from '@/keyboard/commands'
import { LOCAL_SHORTCUTS, findBindingTexts } from '@/keyboard/definitions'
import type { LocalShortcutDefinition, ShortcutWindow } from '@/keyboard/types'

/** 作用域具体度：编辑器 > 视图 > 应用；同键命中多个时具体者优先 */
const SCOPE_RANK: Record<LocalShortcutDefinition['scope'], number> = {
  app: 1,
  view: 2,
  editor: 3
}

type Candidate = {
  definition: LocalShortcutDefinition
  commandId: string
}

/**
 * 当前窗口 label。
 *
 * 非 Tauri 环境（单测 / 浏览器调试）读不到 → 返回 null，表示**不过滤窗口**：
 * 宁可多派发也不能让所有键位静默失效。环境判定与 `features/window/appearance.ts` 同一套。
 */
function findWindowLabel(): string | null {
  if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return null
  return getCurrentWindow().label
}

/**
 * 窗口 label → 键位表里的窗口种类。
 *
 * 浏览窗口可以有多个（`browser`、`browser-2`…），键位表只声明「属于哪一类窗口」，
 * 不关心具体编号。识别不出时返回 null，按「不过滤」处理。
 */
function findWindowKind(label: string | null): ShortcutWindow | null {
  if (!label) return null
  if (label === 'main' || label === 'overlay') return label
  if (isBrowserWindow(label)) return 'browser'
  return null
}

function isFormTag(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  const tag = element?.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element?.isContentEditable === true
}

/** 该键位此刻能不能参与匹配 */
function isCandidate(definition: LocalShortcutDefinition, event: KeyboardEvent, label: string | null): boolean {
  // 编辑器/终端内建绑定：只登记，不接管（否则和 Monaco、xterm 抢键）
  if (definition.owner === 'native') return false
  if (definition.window !== 'any') {
    const kind = findWindowKind(label)
    if (kind && definition.window !== kind) return false
  }
  if (definition.when && !definition.when()) return false

  const target = event.target
  if (isFormTag(target) && !definition.allowInFormTags) return false
  if (isEditable(target) && !definition.allowInEditable) return false

  // 没人注册处理器就不认这一键 —— 不抢没人管的组合（否则会无谓地拦掉浏览器默认行为）
  if (!hasCommand(definition.id)) return false

  return findBindingTexts(definition).some(function (text) {
    return matchesEventText(text, event)
  })
}

function findCandidates(event: KeyboardEvent, label: string | null): Candidate[] {
  const candidates: Candidate[] = []
  for (const definition of LOCAL_SHORTCUTS) {
    if (!isCandidate(definition, event, label)) continue
    candidates.push({ definition, commandId: definition.id })
  }
  candidates.sort(function (left, right) {
    return SCOPE_RANK[right.definition.scope] - SCOPE_RANK[left.definition.scope]
  })
  return candidates
}

/**
 * 派发一次按键。返回是否有人接管。
 *
 * `label` 可注入，便于测试窗口过滤。
 */
async function dispatchKeydown(
  event: KeyboardEvent,
  label: string | null = findWindowLabel()
): Promise<boolean> {
  if (event.defaultPrevented) return false
  if (isModifierEvent(event)) return false

  const candidates = findCandidates(event, label)
  if (candidates.length === 0) return false

  // 同步拦默认行为：浏览器/系统的默认动作在监听器返回后就会执行，等 await 完再拦已经晚了
  event.preventDefault()

  for (const candidate of candidates) {
    if (await runCommand(candidate.commandId)) return true
  }
  return false
}

/** 装单个 keydown 监听；返回卸载函数 */
function installKeyboardDispatcher(): () => void {
  function onKeyDown(event: KeyboardEvent): void {
    void dispatchKeydown(event)
  }
  window.addEventListener('keydown', onKeyDown)
  return function () {
    window.removeEventListener('keydown', onKeyDown)
  }
}

export { dispatchKeydown, findCandidates, findWindowLabel, installKeyboardDispatcher }
export type { Candidate }
