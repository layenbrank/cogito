/**
 * 对话坞的通用键位：`mod+j` 开关当前磁贴的 AI 助手。
 *
 * 只登记一条、所有磁贴共用（同一个键在两份表里会互相冲突）；具体挂载由各磁贴的
 * `use-agent-dock-command` 注册「命令 → 动作」。
 */
import { viewShortcut } from '@/keyboard/definitions/factory'
import { COMMAND } from '@/keyboard/definitions/ids'
import type { LocalShortcutDefinition } from '@/keyboard/types'

export const AGENT_SHORTCUTS: readonly LocalShortcutDefinition[] = [
  viewShortcut(COMMAND.AGENT_DOCK_TOGGLE, '通用：AI 助手（对话坞）', 'mod+j', {
    // 在编辑器/表单里也要能按：坞是「随时叫出来」的入口
    allowInEditable: true,
    allowInFormTags: true
  })
]
