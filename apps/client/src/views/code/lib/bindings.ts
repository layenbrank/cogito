/**
 * 键位文案的唯一出处。
 *
 * 界面上凡是要提示快捷键，都从键位表实时解析（用户改键后跟着变），
 * 不要再手写「Ctrl+P」这类会漂移的字符串。
 */
import { formatBindingText } from '@/keyboard/binding'
import { SHORTCUT_COMMAND, resolveBinding } from '@/keyboard/definitions'

function findBindingText(id: keyof typeof SHORTCUT_COMMAND): string {
  return formatBindingText(resolveBinding(SHORTCUT_COMMAND[id]))
}

/** 「Ctrl+P 转到文件」这种带说明的组合 */
function hint(id: keyof typeof SHORTCUT_COMMAND, label: string): string {
  return `${findBindingText(id)} ${label}`
}

export { findBindingText, hint }
