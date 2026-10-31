/**
 * 消息内联引用角标：把正文里的 `[1]` / `[1,2]` 渲染成可悬浮的来源徽标。
 *
 * 来源提取器由业务侧注册（design 不依赖具体工具语义）。只覆盖 `p` / `li`
 * 两个叶子块，并且只替换字符串子节点 —— 代码块与行内代码是元素节点，不受影响。
 */
import { useAuiState, type TextMessagePartProps } from '@assistant-ui/react'
import { cn } from 'cn'
import { Children, Fragment, useMemo, type ComponentProps, type FC, type ReactNode } from 'react'

import {
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger
} from './inline-citation'
import { MarkdownText } from './markdown-text'

interface CitationSource {
  title: string
  href: string
}

type CitationExtractor = (parts: readonly unknown[]) => readonly CitationSource[]

let extractor: CitationExtractor | null = null

/** 业务侧注册「从消息 parts 里提取来源」的实现；传 null 注销 */
function installCitationExtractor(fn: CitationExtractor | null) {
  extractor = fn
}

const CITATION_MARK = /\[(\d+(?:\s*,\s*\d+)*)\]/g

function CitationBadge(props: { source: CitationSource }) {
  return (
    <InlineCitationCard>
      <InlineCitationCardTrigger sources={[props.source.href]} />
      <InlineCitationCardBody>
        <div className="p-3">
          <a
            href={props.source.href}
            target="_blank"
            rel="noreferrer"
            className="text-foreground text-xs font-medium underline underline-offset-2">
            {props.source.title || props.source.href}
          </a>
          <p className="text-muted-foreground mt-1 text-xs break-all">{props.source.href}</p>
        </div>
      </InlineCitationCardBody>
    </InlineCitationCard>
  )
}

/** 把一段纯文本切成「文字 + 角标」；没有命中时返回 null，调用方原样使用 */
function findCitationNodes(text: string, sources: readonly CitationSource[]): ReactNode[] | null {
  CITATION_MARK.lastIndex = 0
  if (!CITATION_MARK.test(text)) return null
  CITATION_MARK.lastIndex = 0

  const nodes: ReactNode[] = []
  let last = 0
  let matched: RegExpExecArray | null = CITATION_MARK.exec(text)
  while (matched) {
    const at = matched.index
    if (at > last) nodes.push(text.slice(last, at))
    const numbers = matched[1].split(',')
    const mark = matched[0]
    numbers.forEach(function (raw, index) {
      const source = sources[Number(raw.trim()) - 1]
      if (source) {
        nodes.push(
          <CitationBadge
            key={`${at}-${index}`}
            source={source}
          />
        )
      }
    })
    last = at + mark.length
    matched = CITATION_MARK.exec(text)
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function splitChildren(children: ReactNode, sources: readonly CitationSource[]): ReactNode {
  return Children.map(children, function (child) {
    if (typeof child !== 'string') return child
    const nodes = findCitationNodes(child, sources)
    return nodes ? <Fragment>{nodes}</Fragment> : child
  })
}

/**
 * 带引用的正文渲染：没有来源时完全退回默认 MarkdownText，零开销。
 * `state.message.parts` 在渲染 part 时指向当前消息，所以无需额外 Provider。
 */
const CitedMarkdownText: FC<Partial<TextMessagePartProps>> = (props) => {
  const parts = useAuiState(function (state) {
    return state.message.parts
  })

  const citations = useMemo(
    function () {
      return extractor ? extractor(parts) : []
    },
    [parts]
  )

  const components = useMemo(
    function () {
      if (citations.length === 0) return undefined
      return {
        p: function CitedParagraph(paragraph: ComponentProps<'p'>) {
          return (
            <p className={cn('aui-md-p my-3 leading-7 first:mt-0 last:mb-0', paragraph.className)}>
              {splitChildren(paragraph.children, citations)}
            </p>
          )
        },
        li: function CitedListItem(item: ComponentProps<'li'>) {
          return (
            <li className={cn('aui-md-li leading-relaxed', item.className)}>
              {splitChildren(item.children, citations)}
            </li>
          )
        }
      }
    },
    [citations]
  )

  return (
    <MarkdownText
      {...props}
      components={components}
    />
  )
}

export { CitedMarkdownText, installCitationExtractor }
export type { CitationSource, CitationExtractor }
