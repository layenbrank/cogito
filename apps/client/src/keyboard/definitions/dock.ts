/**
 * Agent 相关键位：
 * - `mod+j`：对话坞（各磁贴共用，由 `use-agent-dock-command` 挂动作）
 * - `mod+n`：新建会话（仅 chat 挂载时注册；命令 id 仍是历史名 `agent.newTask`）
 * - `mod+f`：Agent 聊页会话搜索（仅 chat 挂载时 `useCommands` 注册）
 * - `mod+b`：Agent 聊页折叠 / 展开左侧栏（与 code 窗的侧栏键同键，但两者不同时在场）
 * - `mod+shift+b`：折叠 / 展开右侧栏
 * - `mod+alt+shift+b`：专注工作区 / 退出专注
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
  viewShortcut(COMMAND.AGENT_NEW_TASK, '新建会话', 'mod+n', {
    allowInEditable: true,
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.AGENT_FIND, '搜索会话', 'mod+f', {
    allowInEditable: true,
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.AGENT_TOGGLE_SIDEBAR, '显示或隐藏会话列表', 'mod+b', {
    // 在输入框里也要能按（派发器会 preventDefault，不会落到「加粗」上）
    allowInEditable: true,
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.AGENT_TOGGLE_ASIDE, '显示或隐藏工作区', 'mod+shift+b', {
    allowInEditable: true,
    allowInFormTags: true
  }),
  viewShortcut(COMMAND.AGENT_MAXIMIZE_ASIDE, '专注工作区', 'mod+alt+shift+b', {
    allowInEditable: true,
    allowInFormTags: true
  })
]
