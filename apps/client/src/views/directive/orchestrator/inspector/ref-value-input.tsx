/**
 * 单行「字面量 / 纯引用」输入：参数与条件操作数共用。
 * - 纯 `{{…}}` → 引用摘要
 * - 混合文本 → 在光标处插入引用
 * - 路径类参数可本机选文件/目录
 */
import { Button } from '@i-thinking/design/components/button'
import { InputGroup, InputGroupAddon } from '@i-thinking/design/components/input-group'
import { Icon } from '@iconify/react/offline'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { ParamRefPicker, ParamRefSummary } from './param-ref-picker.tsx'
import {
  insertAt,
  parsePureRef,
  type ParamRefContext,
  type PathKind
} from './param-ref.ts'
import { pickLocalPath } from './path-pick.ts'

interface RefValueInputProps {
  id?: string
  value: string
  placeholder?: string
  refContext: ParamRefContext
  onChange: (next: string) => void
  className?: string
  /** 为本机路径参数时显示文件夹/文件按钮 */
  pathKind?: PathKind | null
}

function RefValueInput(props: RefValueInputProps) {
  const purePath = parsePureRef(props.value)
  // 仅在「同一段纯引用」上保持手写覆盖；路径变了或不再是纯引用时自动失效
  const [literalOverride, setLiteralOverride] = useState<string | null>(null)
  const forceLiteral = literalOverride !== null && literalOverride === purePath
  const showRef = Boolean(purePath) && !forceLiteral
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef({ start: 0, end: 0 })

  function rememberSelection() {
    const el = inputRef.current
    if (!el) return
    selectionRef.current = {
      start: el.selectionStart ?? props.value.length,
      end: el.selectionEnd ?? props.value.length
    }
  }

  function replaceAll(wrapped: string) {
    setLiteralOverride(null)
    props.onChange(wrapped)
  }

  /** 混合模板：在上次光标处插入；空串 / 纯引用态则整段替换 */
  function insertOrReplace(wrapped: string) {
    const text = props.value
    if (!text || (parsePureRef(text) && !forceLiteral)) {
      replaceAll(wrapped)
      return
    }

    const { start, end } = selectionRef.current
    const next = insertAt(text, start, end, wrapped)
    setLiteralOverride(parsePureRef(next))
    props.onChange(next)

    requestAnimationFrame(function () {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const pos = Math.min(start, text.length) + wrapped.length
      el.setSelectionRange(pos, pos)
      selectionRef.current = { start: pos, end: pos }
    })
  }

  async function handlePickPath() {
    if (!props.pathKind) return
    try {
      const picked = await pickLocalPath(props.pathKind)
      if (!picked) return
      // 路径选择：整段替换为绝对路径（不是插入引用）
      setLiteralOverride(null)
      props.onChange(picked)
    } catch (error) {
      toast.error('选择路径失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const pathButton = props.pathKind ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={props.pathKind === 'directory' ? '选择目录' : '选择文件'}
      title={props.pathKind === 'directory' ? '选择目录' : '选择文件'}
      onClick={function () {
        void handlePickPath()
      }}>
      <Icon
        icon={props.pathKind === 'directory' ? 'lucide:folder-open' : 'lucide:file'}
        className="size-3.5"
      />
    </Button>
  ) : null

  if (showRef && purePath) {
    return (
      <div className="flex gap-1">
        <div className="min-w-0 flex-1">
          <ParamRefSummary
            path={purePath}
            context={props.refContext}
            onChange={replaceAll}
            onClear={function () {
              setLiteralOverride(null)
              props.onChange('')
            }}
            onEditLiteral={function () {
              setLiteralOverride(purePath)
            }}
          />
        </div>
        {pathButton}
      </div>
    )
  }

  return (
    <InputGroup className={props.className ?? 'h-8'}>
      <input
        ref={inputRef}
        id={props.id}
        data-slot="input-group-control"
        className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2.5 font-mono text-xs outline-none placeholder:text-muted-foreground"
        placeholder={props.placeholder ?? '字面量，或点右侧插入引用'}
        value={props.value}
        onChange={function (event) {
          props.onChange(event.target.value)
        }}
        onSelect={rememberSelection}
        onKeyUp={rememberSelection}
        onClick={rememberSelection}
        onBlur={function () {
          rememberSelection()
          if (parsePureRef(props.value)) replaceAll(props.value.trim())
        }}
      />
      <InputGroupAddon align="inline-end">
        {pathButton}
        <ParamRefPicker
          context={props.refContext}
          currentPath={purePath}
          title="在光标处插入引用"
          onPick={insertOrReplace}
        />
      </InputGroupAddon>
    </InputGroup>
  )
}

export { RefValueInput }
