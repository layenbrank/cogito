import { Input } from '@i-thinking/design/components/input'
import { useState } from 'react'

import { formatShortcut, isValidShortcut } from '@/features/capture/shortcut'

interface ShortcutInputProps {
  value: string
  onCommit: (shortcut: string) => void
}

/**
 * 录制快捷键：聚焦后按键组合，松键提交；无效组合不提交。
 */
function ShortcutInput(props: ShortcutInputProps) {
  const [draft, onDraft] = useState(props.value)
  const [isRecording, onRecording] = useState(false)

  function handleFocus() {
    onRecording(true)
    onDraft('按下快捷键…')
  }

  function handleBlur() {
    onRecording(false)
    onDraft(props.value)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    event.preventDefault()
    event.stopPropagation()
    const next = formatShortcut(event.nativeEvent)
    onDraft(next)
    if (!isValidShortcut(next)) return
    onRecording(false)
    props.onCommit(next)
    ;(event.target as HTMLInputElement).blur()
  }

  return (
    <Input
      className="h-7 w-40 font-mono text-xs"
      value={isRecording ? draft : props.value}
      readOnly
      aria-label="截屏快捷键"
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="点击后按下快捷键"
    />
  )
}

export { ShortcutInput }
export type { ShortcutInputProps }
