/**
 * 把序列化文本（`@<id>` 线格式）渲成与 composer 一致的 chip。
 * 已发送用户消息、只读回显共用，避免露原始线格式。
 *
 * chip 的显示文案不进线格式：`parseDocument` 派生的 label 是 id 本身（skill 去前缀），
 * 浏览器 chip 的页标题只能由视图层实时查 —— 通过 `resolveLabel` 或
 * `setComposerChipLabelResolver` 注入，取不到就退回 label（uuid）。
 */
import { cn } from 'cn'
import { Fragment, memo, useMemo, type ReactNode } from 'react'

import { parseDocument, splitChipLabel, type ComposerAtom } from './composer-document'

/** chip 类型 + id → 显示文案；返回 `undefined` 表示用默认 label */
type ChipLabelResolver = (type: string, id: string) => string | undefined

interface ComposerChipTextProps {
  text: string
  className?: string
  /** 优先于全局解析器（例如某个视图想自己控制文案） */
  resolveLabel?: ChipLabelResolver
}

/**
 * 全局解析器：design 包不能直接依赖 app 的 store，
 * 由宿主在启动时注册（client 里注入浏览器标签页标题）。
 */
let labelResolver: ChipLabelResolver | null = null

function setComposerChipLabelResolver(resolver: ChipLabelResolver | null) {
  labelResolver = resolver
}

/** 供 `thread.aui.tsx` 之类需要在 props 上显式透传的调用点使用 */
function resolveComposerChipLabel(type: string, id: string): string | undefined {
  return labelResolver?.(type, id)
}

function resolveLabelOf(atom: Extract<ComposerAtom, { kind: 'chip' }>, override?: ChipLabelResolver) {
  const resolved = override ? override(atom.type, atom.id) : undefined
  if (resolved !== undefined && resolved.length > 0) return resolved
  const fromRegistry = resolveComposerChipLabel(atom.type, atom.id)
  if (fromRegistry !== undefined && fromRegistry.length > 0) return fromRegistry
  return atom.label
}

function renderAtom(atom: ComposerAtom, key: string, override?: ChipLabelResolver): ReactNode {
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
  const label = resolveLabelOf(atom, override)
  const { dir, base } = splitChipLabel(atom.type, label, atom.id)
  return (
    <span
      key={key}
      data-slot="composer-chip"
      data-chip-type={atom.type}
      data-chip-label={atom.label}
      data-chip-id={atom.id}
      className="aui-composer-chip"
      title={atom.id || undefined}>
      {dir.length > 0 ? (
        <span
          data-slot="chip-dir"
          className="min-w-0 truncate">
          {dir}
        </span>
      ) : null}
      <span
        data-slot="chip-base"
        className="shrink-0">
        {base}
      </span>
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
        return renderAtom(atom, key, props.resolveLabel)
      })}
    </span>
  )
}

const ComposerChipText = memo(ComposerChipTextImpl)

export { ComposerChipText, resolveComposerChipLabel, setComposerChipLabelResolver }
export type { ChipLabelResolver, ComposerChipTextProps }
