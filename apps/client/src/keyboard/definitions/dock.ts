/**
 * Agent 相关键位：
 * - `mod+j`：对话坞（各磁贴共用，由 `use-agent-dock-command` 挂动作）
 * - `mod+f`：Agent 聊页会话搜索（仅 chat 挂载时 `useCommands` 注册）
 * - `mod+b`：Agent 聊页折叠 / 展开左侧栏（与 code 窗的侧栏键同键，但两者不同时在场）
 */
import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

export const AGENT_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  viewShortcut(COMMAND.AGENT_DOCK_TOGGLE, '通用：AI 助手（对话坞）', 'mod+j', {
    // 在编辑器/表单里也要能按：坞是「随时叫出来」的入口
    allowInEditable: true,
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.AGENT_FIND, 'Agent：搜索会话', 'mod+f', {
    allowInEditable: true,
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.AGENT_TOGGLE_SIDEBAR, 'Agent：切换左侧栏', 'mod+b', {
    // 在输入框里也要能按（派发器会 preventDefault，不会落到「加粗」上）
    allowInEditable: true,
    allowInFormTags: true
  })
]
