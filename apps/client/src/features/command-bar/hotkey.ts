/**
 * 主窗 Ctrl/⌘+K 聚焦 Omnibar
 */
import { useMemo } from 'react'

import { COMMAND } from '@/keyboard/definitions/ids'
import { useCommands } from '@/keyboard/react'
import type { Command } from '@/keyboard/types'

function focusCommandBar(): boolean {
  window.dispatchEvent(new CustomEvent('command-bar:focus'))
  return true
}

function useCommandBarHotkey(): void {
  const commands = useMemo(function (): Command[] {
    return [
      {
        id: COMMAND.COMMAND_BAR_FOCUS,
        title: '聚焦命令栏',
        keywords: 'command bar omnibar search',
        run: function () {
          void focusCommandBar()
        }
      }
    ]
  }, [])
  useCommands(commands)
}

export { focusCommandBar, useCommandBarHotkey }
