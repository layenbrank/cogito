import { Input } from '@i-thinking/design/components/input'
import { useState } from 'react'

import {
  bindingFromEvent,
  bindingToText,
  formatBindingText,
  validateBinding
} from '@/keyboard/binding'
import type { ShortcutScope } from '@/keyboard/types'

interface ShortcutInputProps {
  value: string
  /** 校验强度按作用域区分：全局键必须显式修饰键，局部键允许裸键 */
  scope: ShortcutScope
  /**
   * 提交回调。返回 `false` 表示拒绝（如与其它键位冲突），输入框会留在录制态让用户重按。
   */
  onCommit: (shortcut: string) => boolean | Promise<boolean>
  ariaLabel?: string
}

/**
 * 录制快捷键：聚焦后按键组合，凑齐一个合法键位就提交。
 *
 * 只按修饰键不算；不合法的组合只提示不提交。校验规则全在 `keyboard/binding.ts`，
 * 这里不重复实现。冲突判定由 `onCommit` 返回 `false` 表达。
 */
function ShortcutInput(props: ShortcutInputProps) {
  const [draft, onDraft] = useState<string | null>(null)

  function handleFocus() {
    onDraft('按下快捷键…')
  }

  function handleBlur() {
    onDraft(null)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    event.preventDefault()
    event.stopPropagation()

    const binding = bindingFromEvent(event.nativeEvent)
    if (!binding) {
      onDraft('按下快捷键…')
      return
    }

    const text = bindingToText(binding)
    const error = validateBinding(text, props.scope)
    if (error) {
      onDraft(error)
      return
    }

    onDraft(formatBindingText(text))
    const element = event.target as HTMLInputElement
    void Promise.resolve(props.onCommit(text)).then(function (accepted) {
      if (accepted === false) return
      element.blur()
    })
  }

  return (
    <Input
      className="h-7 w-44 font-mono text-xs"
      value={draft ?? formatBindingText(props.value)}
      readOnly
      aria-label={props.ariaLabel ?? '快捷键'}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="点击后按下快捷键"
    />
  )
}

export { ShortcutInput }
export type { ShortcutInputProps }
