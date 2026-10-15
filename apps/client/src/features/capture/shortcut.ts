import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { runCapturePrune } from '@/features/capture/retention'
import { dispatchKeyCode } from '@/keycodes/dispatcher'
import { CHANNELS } from '@/shared/ipc/channels'
import { useSettingsStore } from '@/stores/setting'

/** 默认快捷键：设置未初始化 / 读取失败时兜底 */
const SHORTCUT = 'Alt+Q'

/** 全局快捷键只由主窗注册；overlay 与各磁贴窗都不参与 */
const MAIN_WINDOW_LABEL = 'main'

const MODIFIER_KEYS = new Set([
  'Control',
  'Alt',
  'Shift',
  'Meta',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight'
])

/** 修饰键名（含 Tauri 接受的别名）：判定「只按了修饰键」与「是否含修饰键」共用 */
const MODIFIER_ALIASES = new Set([
  'Control',
  'Ctrl',
  'Alt',
  'Option',
  'Shift',
  'Meta',
  'Super',
  'Cmd',
  'Command',
  'CmdOrCtrl',
  'CommandOrControl'
])

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc'
}

/**
 * 将键盘事件格式化为 Tauri global-shortcut 字符串（如 `Control+Shift+A`）。
 */
function formatShortcut(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')

  const raw = event.key
  // 只按了修饰键 → 返回修饰键串；调用方用 isValidShortcut 判定为无效，不提交
  if (MODIFIER_KEYS.has(raw) || MODIFIER_ALIASES.has(raw)) return parts.join('+')

  const aliased = KEY_ALIASES[raw] ?? raw
  const primary =
    aliased.length === 1 ? aliased.toUpperCase() : aliased.charAt(0).toUpperCase() + aliased.slice(1)
  parts.push(primary)
  return parts.join('+')
}

/**
 * 至少一个修饰键 + 一个主键。
 */
function isValidShortcut(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const parts = trimmed.split('+').filter(Boolean)
  if (parts.length < 2) return false

  let hasModifier = false
  let hasPrimary = false
  for (const part of parts) {
    if (MODIFIER_ALIASES.has(part)) hasModifier = true
    else hasPrimary = true
  }
  return hasModifier && hasPrimary
}

/** 当前已生效的快捷键；null = 未注册（禁用或注册失败） */
let activeShortcut: string | null = null

/**
 * register / unregister 的串行队列。
 *
 * 曾出过的问题：切换快捷键时「撒销旧键」与「注册新键」并发，或上一次 effect 的 cleanup
 * 注销晚于新注册落地 → 最后一个动作落在 unregister 上，结果**按了没有任何反应**。
 * 所有变更都必须排进这条队列。
 */
let queue: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task)
  return queue
}

async function requestCapture(): Promise<void> {
  try {
    const handled = await dispatchKeyCode('screenshot')
    if (handled) return
    await invoke(CHANNELS.CAPTURE.OPEN)
  } catch (error) {
    console.error('[capture] 启动截屏失败', error)
    const text = error instanceof Error ? error.message : String(error)
    toast.error(`截屏没能打开：${text}`)
  }
}

function onShortcutPressed(event: { state?: string }): void {
  if (event.state !== 'Pressed') return
  void requestCapture()
}

/** 注册快捷键；同名残留（上一次会话 / 热重载）先撤掉再重试一次 */
async function registerShortcut(shortcut: string): Promise<void> {
  try {
    await register(shortcut, onShortcutPressed)
  } catch (error) {
    if (
      !(await isRegistered(shortcut).catch(function () {
        return false
      }))
    ) {
      throw error
    }
    await unregister(shortcut)
    await register(shortcut, onShortcutPressed)
  }
}

/** 切换快捷键：旧键先撤、新键再注册；新键失败时尽量保住旧键并抛出 */
async function applyShortcut(shortcut: string): Promise<string | null> {
  if (activeShortcut === shortcut) return activeShortcut

  const previous = activeShortcut
  if (previous) {
    activeShortcut = null
    await unregister(previous).catch(function (error) {
      console.warn('[capture] 注销旧快捷键失败', error)
    })
  }

  if (!isValidShortcut(shortcut)) return null

  try {
    await registerShortcut(shortcut)
    activeShortcut = shortcut
    return shortcut
  } catch (error) {
    if (previous) {
      try {
        await registerShortcut(previous)
        activeShortcut = previous
      } catch (restoreError) {
        console.warn('[capture] 恢复原快捷键失败', restoreError)
      }
    }
    throw error
  }
}

/** 串行 + 幂等地切换截图快捷键（同一个值重复调用不会重复注册） */
function bindCaptureShortcut(shortcut: string): Promise<void> {
  return enqueue(function () {
    return applyShortcut(shortcut).then(function (applied) {
      if (applied) console.info('[capture] 截图快捷键已生效：', applied)
    })
  })
}

function findActiveShortcut(): string | null {
  return activeShortcut
}

/** 当前窗口是否为主窗（非 Tauri 环境或其它窗口返回 false） */
function isMainWindow(): boolean {
  try {
    return getCurrentWindow().label === MAIN_WINDOW_LABEL
  } catch (error) {
    console.warn('[capture] 读取当前窗口失败', error)
    return false
  }
}

/**
 * 主窗口常驻注册截屏快捷键：值取自设置，变更即切换；失败会提示并把设置回滚到仍在生效的键。
 *
 * 注意**不在 cleanup 里注销** —— 注销必须与注册排队，否则「设置初始化完成」触发的重跑
 * 会把刚注册的键撤掉（按了没反应的根因）。
 */
function useCaptureShortcut(): void {
  const shortcut = useSettingsStore(function (state) {
    return state.settings.capture.shortcut
  })

  useEffect(
    function () {
      let cancelled = false

      void (async function () {
        try {
          if (!isMainWindow()) return
          await useSettingsStore.getState().toInitialize()
          if (cancelled) return

          void runCapturePrune({ silent: true })

          const next = useSettingsStore.getState().settings.capture.shortcut || SHORTCUT
          await bindCaptureShortcut(next)
        } catch (error) {
          if (cancelled) return
          console.error('[capture] 注册截图快捷键失败', error)
          const text = error instanceof Error ? error.message : String(error)
          toast.error(`快捷键没能生效：${text}`)

          const fallback = findActiveShortcut() ?? SHORTCUT
          if (fallback !== shortcut) {
            await useSettingsStore.getState().toUpdate('capture', { shortcut: fallback })
          }
        }
      })()

      return function () {
        cancelled = true
      }
    },
    [shortcut]
  )
}

export {
  SHORTCUT,
  bindCaptureShortcut,
  findActiveShortcut,
  formatShortcut,
  isValidShortcut,
  useCaptureShortcut
}
