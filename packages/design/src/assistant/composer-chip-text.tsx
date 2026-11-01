/**
 * 把序列化文本（含 `:type[label]{name=id}`）渲成与 composer 一致的 chip。
 * 已发送用户消息、只读回显共用，避免再露原始 directive。
 */
import { cn } from 'cn'
import { Fragment, memo, useMemo, type ReactNode } from 'react'

import { parseDocument, type ComposerAtom } from './composer-document'

interface ComposerChipTextProps {
  text: string
  className?: string
}

function renderAtom(atom: ComposerAtom, key: string): ReactNode {
  if (atom.kind === 'text') {
    return <Fragment key={key}>{atom.text}</Fragment>
  }
  if (atom.kind === 'break') {
    return (
      <br
        key={key}
        data-slot="composer-chip-break"
      />
    )
  }
  return (
    <span
      key={key}
      data-slot="composer-chip"
      data-chip-type={atom.type}
      data-chip-label={atom.label}
      data-chip-id={atom.id}
      className="aui-composer-chip"
      title={atom.id || undefined}>
      {atom.label}
    </span>
  )
}

function ComposerChipTextImpl(props: ComposerChipTextProps) {
  const atoms = useMemo(
    function () {
      return parseDocument(props.text)
    },
    [props.text]
  )

  if (atoms.length === 0) return null

  return (
    <span
      data-slot="composer-chip-text"
      className={cn('whitespace-pre-wrap', props.className)}>
      {atoms.map(function (atom, index) {
        const key =
          atom.kind === 'chip'
            ? `chip-${index}-${atom.type}-${atom.id}`
            : atom.kind === 'break'
              ? `br-${index}`
              : `text-${index}-${atom.text.length}`
        return renderAtom(atom, key)
      })}
    </span>
  )
}

const ComposerChipText = memo(ComposerChipTextImpl)

export { ComposerChipText }
export type { ComposerChipTextProps }
