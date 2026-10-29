/**
 * React 绑定层：把命令注册表、局部键派发器、全局键管理器接到组件生命周期上。
 *
 * 两个刻意的设计：
 * - 回调与 `enabled` 都塞进 ref，effect 只依赖 id —— 否则调用方每次 render 传新对象都会
 *   反复注销/注册（旧 `useKeyCode` 的 `options` 依赖就有这个毛病）。
 * - 注册与派发分离：`useShortcut` 只登记处理器，装监听是 `useKeyboard` 在 App 层做一次。
 */

import { useEffect, useLayoutEffect, useRef } from 'react'

import { COMMAND_PRIORITY, registerCommands, registerHandler } from '@/keyboard/commands'
import type { CommandHandler } from '@/keyboard/commands'
import { installKeyboardDispatcher } from '@/keyboard/dispatcher'
import { useGlobalShortcuts } from '@/keyboard/global'
import type { Command } from '@/keyboard/types'

type UseShortcutOptions = {
  priority?: number
  enabled?: () => boolean
}

/**
 * 让组件接管某个命令对应的键位。
 *
 * `handler` 返回 `true` 表示「这一键我接管了」，派发就此停止；返回 `false`/`undefined` 交给下一位
 * （最终会落到命令自己的 `run`）。截屏键就是这个模式：磁贴在场就磁贴接管，否则兜底打开截屏浮层。
 */
function useShortcut(
  id: string,
  handler: CommandHandler,
  options?: UseShortcutOptions
): void {
  const latest = useRef({ handler, enabled: options?.enabled })

  useLayoutEffect(function () {
    latest.current = { handler, enabled: options?.enabled }
  })

  const priority = options?.priority ?? COMMAND_PRIORITY

  useEffect(
    function () {
      return registerHandler(
        id,
        function () {
          return latest.current.handler()
        },
        {
          priority,
          enabled: function () {
            const enabled = latest.current.enabled
            return enabled ? enabled() : true
          }
        }
      )
    },
    [id, priority]
  )
}

/**
 * 注册一批命令（视图挂载时调用）。未挂载的视图，其命令不会出现在命令面板里。
 *
 * 依赖只用 id 列表：`commands` 每次 render 都是新数组，用 ref 取最新的 `run`。
 */
function useCommands(commands: readonly Command[]): void {
  const latest = useRef(commands)

  useLayoutEffect(function () {
    latest.current = commands
  })

  const ids = commands
    .map(function (command) {
      return command.id
    })
    .join('|')

  useEffect(
    function () {
      const registered = latest.current.map(function (command) {
        return {
          ...command,
          run: function () {
            const found = latest.current.find(function (candidate) {
              return candidate.id === command.id
            })
            return found ? found.run() : undefined
          }
        }
      })
      return registerCommands(registered)
    },
    [ids]
  )
}

/** App 层挂一次：装全局 keydown 监听 + 在主窗注册全局键 */
function useKeyboard(): void {
  useEffect(installKeyboardDispatcher, [])
  useGlobalShortcuts()
}

export { useCommands, useKeyboard, useShortcut }
export type { UseShortcutOptions }
