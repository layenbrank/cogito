/**
 * 把序列化文本（`@<id>` 线格式）渲成与 composer 一致的 chip。
 * 已发送用户消息、只读回显共用，避免露原始线格式。
 *
 * chip 的显示文案不进线格式：`parseDocument` 派生的 label 是 id 本身（skill 去前缀），
 * 浏览器 chip 的页标题只能由视图层实时查 —— 通过 `resolveLabel` 或
 * `setComposerChipLabelResolver` 注入，取不到就退回 label（uuid）。
 *
 * **单行模式**（`singleLine`）：队列折叠头 / 队列条目这类「预览」场景用。
 * `whitespace-pre-wrap` 会覆盖父级的 `truncate`（`nowrap` 被继承值改掉），
 * `<br>` 更是让 `text-overflow` 直接失效 —— 所以单行不是「用 CSS 硬裁」，
 * 而是先把文档摊平（换行变空格、去掉 break atom），再让 `truncate` 生效。
 * 语义上这是预览不是原文：全文仍在 `title` 与展开后的正文里。
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
  /** 单行预览：换行折成空格、不渲染 `<br>`、chip 限宽 */
  singleLine?: boolean
}

/** 单行模式下 chip 的最大宽度：一个 chip 不至于把整行占满，行尾还能看到 `…` */
const SINGLE_LINE_CHIP_MAX_CLASS = 'max-w-[9rem]'

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

/**
 * 单行化：`break` → 空格、`text` 内的 `\n` / `\r\n` → 空格、相邻文本合并。
 *
 * 纯函数，单测直接断言（不依赖 DOM）：单行模式的约束是「文档里没有换行」，
 * 而不是「渲染完看起来像一行」。
 */
function flattenSingleLine(atoms: readonly ComposerAtom[]): ComposerAtom[] {
  const out: ComposerAtom[] = []
  function pushText(text: string) {
    if (text.length === 0) return
    const last = out[out.length - 1]
    if (last && last.kind === 'text') {
      out[out.length - 1] = { kind: 'text', text: last.text + text }
      return
    }
    out.push({ kind: 'text', text })
  }
  for (const atom of atoms) {
    if (atom.kind === 'text') {
      pushText(atom.text.replace(/\r\n|\r|\n/g, ' '))
      continue
    }
    if (atom.kind === 'break') {
      pushText(' ')
      continue
    }
    out.push(atom)
  }
  return out
}

/** 文本里有多少「显示行」（与队列上的 `⏎ N 行` 标记同一口径） */
function countComposerLines(text: string): number {
  if (text.length === 0) return 0
  return text.split(/\r\n|\r|\n/).length
}

function renderAtom(
  atom: ComposerAtom,
  key: string,
  override?: ChipLabelResolver,
  singleLine?: boolean
): ReactNode {
  if (atom.kind === 'text') {
    return <Fragment key={key}>{atom.text}</Fragment>
  }
  // 单行模式里 break 已被 flatten 折成空格；这里只防「有人绕过 flatten 直接喂 atom」
  if (atom.kind === 'break') {
    if (singleLine) return <Fragment key={key}> </Fragment>
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
      className={cn('aui-composer-chip', singleLine && SINGLE_LINE_CHIP_MAX_CLASS)}
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

  const singleLine = props.singleLine === true
  const visible = useMemo(
    function () {
      return singleLine ? flattenSingleLine(atoms) : atoms
    },
    [atoms, singleLine]
  )

  if (visible.length === 0) return null

  return (
    <span
      data-slot="composer-chip-text"
      data-single-line={singleLine ? 'true' : undefined}
      className={cn(
        singleLine ? 'block w-full min-w-0 truncate' : 'whitespace-pre-wrap',
        props.className
      )}>
      {visible.map(function (atom, index) {
        const key =
          atom.kind === 'chip'
            ? `chip-${index}-${atom.type}-${atom.id}`
            : atom.kind === 'break'
              ? `br-${index}`
              : `text-${index}-${atom.text.length}`
        return renderAtom(atom, key, props.resolveLabel, singleLine)
      })}
    </span>
  )
}

const ComposerChipText = memo(ComposerChipTextImpl)

export {
  ComposerChipText,
  SINGLE_LINE_CHIP_MAX_CLASS,
  countComposerLines,
  flattenSingleLine,
  resolveComposerChipLabel,
  setComposerChipLabelResolver
}
export type { ChipLabelResolver, ComposerChipTextProps }
