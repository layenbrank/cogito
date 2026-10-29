/**
 * 全局键管理器（OS 级，Tauri `plugin-global-shortcut`）。
 *
 * 与局部键的本质差异，全在这个文件里体现：
 * - **整个应用只有一份**，且只能由主窗注册（`overlay` 窗也跑同一份 JS 包，但 OS 热键不该注册两次）；
 * - 拿不到 DOM 事件，所以触发后只能落到「谁接管的命令」上（`runCommand`），不存在 preventDefault；
 * - 与系统/其它应用抢键是常态，所以要处理「想要的组合注册不上」——
 *
 * 失败处理顺序（对应设置页上会看到的三种状态）：
 * 1. 想要的组合注册成功 → `active`
 * 2. 失败但有**可用的旧值** → 回滚旧值，本次改动不生效 → `fallback`
 * 3. 没有旧值（首次运行 / 从未成功）→ 按定义里的 `fallbacks` 链依次试，首个成功者生效 → `fallback`
 * 4. 旧值也不行、备用链全失败 → `unavailable`（`effective: null`），**绝不留下假的「已注册」标记**
 *
 * 无论哪种情况，`effective` 都只改运行时，**不覆写用户在设置里写的值**。
 */

import { getCurrentWindow } from '@tauri-apps/api/window'
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { toAcceleratorText, validateBinding } from '@/keyboard/binding'
import { runCommand } from '@/keyboard/commands'
import { GLOBAL_SHORTCUTS, resolveBinding } from '@/keyboard/definitions'
import { reportCaught } from '@/utils/exception-report'
import { publishGlobalShortcuts, readGlobalShortcuts } from '@/keyboard/state'
import type { GlobalShortcutDefinition, GlobalShortcutRuntime } from '@/keyboard/types'
import { useSettingsStore } from '@/stores/setting'

/** 全局热键只在主窗注册 */
const MAIN_WINDOW_LABEL = 'main'

/** id → 当前真正注册在 OS 上的 accelerator（null = 没注册） */
const activeBindings = new Map<string, string | null>()

/**
 * register / unregister 的串行队列。
 *
 * 曾经的问题：切换快捷键时「撤旧键」与「注册新键」并发，或上一次 effect 的 cleanup 注销晚于新注册
 * 落地 → 最后一个动作落在 unregister 上，结果**按了没有任何反应**。所有变更都必须排进这条队列。
 */
let queue: Promise<void> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  // 队列自身只关心「上一件事结束了」，不让失败中断后续任务
  queue = result.then(
    function () {},
    function () {}
  )
  return result
}

function isMainWindow(): boolean {
  // 环境判定与 `features/window/appearance.ts` 同一套；非 Tauri 环境下不碰全局键
  if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return false
  return getCurrentWindow().label === MAIN_WINDOW_LABEL
}

function onGlobalPressed(id: string, definition: GlobalShortcutDefinition): (event: { state?: string }) => void {
  return function (event) {
    // 只认按下，忽略抬起 —— OS 回调按下/抬起都会来
    if (event.state !== 'Pressed') return
    void runCommand(id).then(function (handled) {
      if (!handled) console.warn(`[keyboard] 全局键「${definition.title}」触发了但没人处理`)
    })
  }
}

/** 注册结果：失败时把原因带出去，供设置页提示（不在这里吞掉） */
type RegisterResult = { ok: boolean; error?: unknown }

/** 注册；同名残留（上次会话 / 热重载）先撤再试一次 */
async function tryRegister(
  id: string,
  accelerator: string,
  definition: GlobalShortcutDefinition
): Promise<RegisterResult> {
  try {
    await register(accelerator, onGlobalPressed(id, definition))
    return { ok: true }
  } catch (error) {
    // 占用是常态，先在 debug 级留痕；最终不可用时会再 warn 一次带结论的
    console.debug('[keyboard] 全局键注册未成功，探测是否被占用', { accelerator, error })
    const occupied = await isRegistered(accelerator).catch(function () {
      return false
    })
    if (!occupied) return { ok: false, error }
    try {
      await unregister(accelerator)
      await register(accelerator, onGlobalPressed(id, definition))
      return { ok: true }
    } catch (retryError) {
      console.debug('[keyboard] 撤销同名残留后仍注册失败', { accelerator, retryError })
      return { ok: false, error: retryError }
    }
  }
}

/** 撤掉当前已注册的组合 */
async function release(id: string): Promise<void> {
  const current = activeBindings.get(id)
  if (!current) return
  activeBindings.set(id, null)
  await unregister(current).catch(function (error: unknown) {
    console.warn('[keyboard] 注销全局键失败', { id, current, error })
  })
}

function describeUnavailable(text: string, error: string): GlobalShortcutRuntime {
  return { state: 'unavailable', desired: text, effective: null, error }
}

async function syncGlobalShortcut(
  definition: GlobalShortcutDefinition,
  desiredText: string
): Promise<GlobalShortcutRuntime> {
  const previous = activeBindings.get(definition.id) ?? null
  const invalid = desiredText ? validateBinding(desiredText, 'global') : '未设置快捷键'
  const wanted = invalid ? null : toAcceleratorText(desiredText)

  // 已经是想要的状态：不碰注册，只刷新描述（diff 到这一步就停，避免无谓的注销/注册）
  if (wanted === previous) {
    if (wanted) return { state: 'active', desired: desiredText, effective: wanted }
    return describeUnavailable(desiredText, invalid ?? '未设置快捷键')
  }

  await release(definition.id)

  let wantedFailure: unknown
  if (wanted) {
    const result = await tryRegister(definition.id, wanted, definition)
    if (result.ok) {
      activeBindings.set(definition.id, wanted)
      return { state: 'active', desired: desiredText, effective: wanted }
    }
    wantedFailure = result.error
  }

  const busy = `组合 ${desiredText} 被系统或其它应用占用`

  // 有可用旧值 → 回滚，本次改动不生效（用户看到「仍使用旧值」）
  if (previous && previous !== wanted) {
    const rollback = await tryRegister(definition.id, previous, definition)
    if (rollback.ok) {
      activeBindings.set(definition.id, previous)
      return {
        state: 'fallback',
        desired: desiredText,
        effective: previous,
        error: `${busy}，仍使用 ${previous}`
      }
    }
  }

  // 没有可用旧值（或旧值也失败）→ 按备用链兜底
  for (const candidate of definition.fallbacks) {
    const accelerator = toAcceleratorText(candidate)
    if (!accelerator || accelerator === wanted) continue
    const result = await tryRegister(definition.id, accelerator, definition)
    if (result.ok) {
      activeBindings.set(definition.id, accelerator)
      return {
        state: 'fallback',
        desired: desiredText,
        effective: accelerator,
        error: `${busy}，临时改用 ${candidate}`
      }
    }
  }

  // 想要的、旧值、备用链全失败 → 明确「不可用」，绝不留下假的已注册标记
  const failure = `${busy}，且备用组合也不可用，请在设置里换一个`
  console.warn('[keyboard] 全局快捷键不可用', {
    id: definition.id,
    desired: desiredText,
    failure,
    cause: wantedFailure
  })
  return describeUnavailable(desiredText, failure)
}

/** 目标状态：每个全局键当前应该注册什么 */
function findDesiredGlobalBindings(): Record<string, string> {
  const desired: Record<string, string> = {}
  for (const definition of GLOBAL_SHORTCUTS) {
    desired[definition.id] = resolveBinding(definition.id)
  }
  return desired
}

/**
 * 按 diff 应用全局键（只动变化项）。串行执行，可重复调用。
 */
function syncGlobalShortcuts(desired: Record<string, string>): Promise<void> {
  return enqueue(async function () {
    const next = { ...readGlobalShortcuts() }
    for (const definition of GLOBAL_SHORTCUTS) {
      next[definition.id] = await syncGlobalShortcut(definition, desired[definition.id] ?? '')
    }
    publishGlobalShortcuts(next)
  })
}

/** 当前生效的 accelerator；测试与排查用 */
function findActiveGlobalBinding(id: string): string | null {
  return activeBindings.get(id) ?? null
}

/**
 * 主窗常驻：装 DOM 派发 + 拉起全局键；设置里的全局键变化时只 diff 变更项。
 *
 * 刻意**不在 cleanup 里注销**：注销必须与注册排队，否则「设置初始化完成」触发的重跑会把刚注册的键
 * 撤掉（历史上「按了没反应」的根因）。
 */
function useGlobalShortcuts(): void {
  // 只依赖全局键的覆盖值：局部键改动不应触发 OS 层重新注册
  const globalOverrides = useSettingsStore(function (state) {
    const bindings = state.settings.shortcuts.bindings
    return GLOBAL_SHORTCUTS.map(function (definition) {
      return bindings[definition.id] ?? ''
    }).join('\u0000')
  })

  useEffect(
    function () {
      if (!isMainWindow()) return
      let cancelled = false

      void (async function () {
        try {
          await useSettingsStore.getState().toInitialize()
          if (cancelled) return
          await syncGlobalShortcuts(findDesiredGlobalBindings())
        } catch (error) {
          if (cancelled) return
          reportCaught('keyboard.syncGlobalShortcuts', error)
          const text = error instanceof Error ? error.message : String(error)
          toast.error(`快捷键没能生效：${text}`)
        }
      })()

      return function () {
        cancelled = true
      }
    },
    [globalOverrides]
  )
}

export {
  MAIN_WINDOW_LABEL,
  syncGlobalShortcuts,
  findActiveGlobalBinding,
  findDesiredGlobalBindings,
  isMainWindow,
  useGlobalShortcuts
}
