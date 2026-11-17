/**
 * Document reference（对齐 assistant-ui `elements/document-reference`）
 *
 * 一张「答案依据了哪个文档」的引用卡：抬头是文件名 + `N 页 · M 处引用`，
 * 下面逐个列出引用到的页与原文片段，点一下跳到那一页。
 *
 * 与 `retrieval-chunks` 的分工：
 * - retrieval-chunks 是**检索命中的段落**（一段一个卡片，带相关度）；
 * - 本元素是**同一份文档里的多个定位**（一篇文档一张卡，锚点是页码 + 引文）。
 *
 * 元素本体是收费产物，结构与无障碍按官网 `Anatomy` / API 契约自写：
 * - 恰好一个锚点是「当前」，带高亮底色与 `aria-current`；
 * - 用户点过的那一个优先（同一页可能有多处引用，只有被点的那一处算当前）；
 *   否则取数组里第一个 `page === activePage` 的锚点；
 * - 没传 `onJump` 时锚点是只读参考行（没有「当前」这回事）；
 * - 切换文档（`title` 变）或那一处引文已经不在了，旧的点选就作废。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useMemo, useState, type ComponentProps } from 'react'

import { field, mono, paper, rowEnter } from './elements/surfaces'
import { useAssistantLabels } from './labels'

/** 一处引用：第几页 + 原文片段 */
interface DocumentAnchor {
  page: number
  quote: string
}

interface DocumentReferenceProps extends Omit<ComponentProps<'div'>, 'title' | 'children'> {
  /** 文件名 / 文档标题 */
  title: string
  /** 总页数（只用于抬头那行元信息，不与 anchors 交叉校验） */
  pages: number
  /** 引用到的位置，按给出的顺序排列 */
  anchors: readonly DocumentAnchor[]
  /** 要高亮哪一页；可能匹配不到、也可能匹配到多个 */
  activePage: number
  /** 点锚点时回调；不传则锚点不可点 */
  onJump?: (page: number) => void
}

/** 用户点过的锚点：只在「同一份文档 + 那一处引文还在原位」时生效 */
interface PickedAnchor {
  title: string
  index: number
  quote: string
}

function DocumentReference({
  title,
  pages,
  anchors,
  activePage,
  onJump,
  className,
  ...props
}: DocumentReferenceProps) {
  const labels = useAssistantLabels()
  const [picked, setPicked] = useState<PickedAnchor | null>(null)

  const currentIndex = useMemo(
    function () {
      if (!onJump) return -1
      if (picked && picked.title === title) {
        const anchor = anchors[picked.index]
        if (anchor && anchor.quote === picked.quote) return picked.index
      }
      return anchors.findIndex(function (anchor) {
        return anchor.page === activePage
      })
    },
    [activePage, anchors, onJump, picked, title]
  )

  return (
    <div
      data-slot="document-reference"
      {...props}
      className={cn(paper, rowEnter, 'flex flex-col gap-2.5 rounded-2xl p-3.5', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            field,
            'text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl'
          )}>
          <Icon
            icon="lucide:file-text"
            className="size-4"
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            data-slot="document-reference-title"
            title={title}
            className="text-foreground/90 min-w-0 truncate text-sm font-medium">
            {title}
          </span>
          <span
            data-slot="document-reference-meta"
            className={mono}>
            {labels.documentPages(pages, anchors.length)}
          </span>
        </div>
      </div>

      {anchors.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          {anchors.map(function (anchor, index) {
            const current = index === currentIndex
            const content = (
              <>
                <span
                  data-slot="document-anchor-page"
                  className={cn(mono, 'shrink-0 tabular-nums')}>
                  {labels.documentPageLabel(anchor.page)}
                </span>
                <span className="text-foreground/80 line-clamp-2 min-w-0 flex-1 text-xs leading-relaxed">
                  {anchor.quote}
                </span>
              </>
            )
            const shell = cn(
              'flex w-full min-w-0 items-start gap-2 rounded-xl px-2.5 py-2 text-start transition-colors',
              current ? field : 'hover:bg-foreground/[0.03]'
            )
            if (!onJump) {
              return (
                <div
                  key={index}
                  data-slot="document-anchor"
                  className={shell}>
                  {content}
                </div>
              )
            }
            return (
              <button
                key={index}
                type="button"
                data-slot="document-anchor"
                data-active={current ? 'true' : undefined}
                aria-current={current ? 'true' : undefined}
                aria-label={labels.documentJump(anchor.page)}
                className={cn(shell, 'outline-hidden focus-visible:ring-1 focus-visible:ring-foreground/20')}
                onClick={function () {
                  setPicked({ title, index, quote: anchor.quote })
                  onJump(anchor.page)
                }}>
                {content}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export { DocumentReference }
export type { DocumentAnchor, DocumentReferenceProps }
