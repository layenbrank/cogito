/**
 * 注册「AI 助手」命令：命令面板能搜到，`mod+j` 也能触发。
 *
 * 每个磁贴各调一次（各自窗口一个命令注册表）；动作固定是开关当前 scope 的对话坞。
 */
import { useCommands } from '@/keyboard/react'
import { SHORTCUT_COMMAND } from '@/keyboard/definitions'

import { useDockStore } from './store'

function useAgentDockCommand(): void {
  useCommands([
    {
      id: SHORTCUT_COMMAND.AGENT_DOCK_TOGGLE,
      title: 'AI 助手：打开 / 收起对话坞',
      keywords: 'ai dock agent 助手 对话',
      group: '通用',
      run: function () {
        useDockStore.getState().toToggle()
      }
    }
  ])
}

export { useAgentDockCommand }
