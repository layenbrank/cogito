/**
 * Web search（对齐 assistant-ui `elements/web-search`）
 *
 * 一次联网检索的三段：**查询词一颗药丸**、状态行（读了几条 / 正在搜）、**结果一行一条**。
 * 每条结果是「域名首字母徽章 + 标题 + 域名」，域名走 `mono` 右对齐 —— 扫读顺序是
 * 「先认站、再看标题」，跟书签栏一样；整条不给卡片外壳，它就是一段有结构的正文，
 * 不该比回答本身更抢眼。
 *
 * 与 `sources.tsx`（回答末尾「引用 N 个来源」折叠条）的分工：
 * - sources 是**收据**：这段回答引了谁；
 * - 本元素是**过程**：这次检索查了什么、落进来哪些结果，跑完也不换形状。
 *
 * 元素本体是收费产物，DOM 结构 / 状态 / 动画按官网渲染结果与本仓 token 自写：
 * 结果行逐条进场（`rowEnter`），`cycle` 混进 key 让同一查询重搜时动画能重放。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import { field, mono, rowEnter } from './elements/surfaces'
import { useAssistantLabels } from './labels'
import { toDomainInitial, type WebSearchResult } from './web-search-state'

// `results` 与 HTML 的 `results` 属性重名，一并摘掉（元素自己的 prop 优先）
interface WebSearchProps extends Omit<React.ComponentProps<'div'>, 'children' | 'results'> {
  /** 检索词：常显在药丸里（字段还在流式时给占位词） */
  query: string
  /** 全量结果；只渲染前 `visibleResults` 条 */
  results: readonly WebSearchResult[]
  /** 结果逐条落进来的进度 */
  visibleResults: number
  /** 检索中：状态行换成 shimmer 文案，结果行不动 */
  searching: boolean
  /** 换一次检索加一：混进结果行的 key，让进场动画重放 */
  cycle: number
}

const RESULT_ROW_CLASS = cn(
  rowEnter,
  'hover:bg-foreground/[0.03] -mx-2.5 flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors duration-300'
)

function WebSearchResultRow(props: { result: WebSearchResult }) {
  const { result } = props
  const body = (
    <>
      <span
        data-slot="web-search-result-initial"
        aria-hidden
        className="bg-foreground/[0.06] text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded text-xs leading-none font-medium">
        {toDomainInitial(result.domain)}
      </span>
      <span className="text-foreground/90 min-w-0 flex-1 truncate text-sm">{result.title}</span>
      <span className={cn(mono, 'shrink-0')}>{result.domain}</span>
    </>
  )

  if (result.href) {
    return (
      <a
        data-slot="web-search-result"
        href={result.href}
        target="_blank"
        rel="noreferrer"
        title={result.href}
        className={RESULT_ROW_CLASS}>
        {body}
      </a>
    )
  }
  return (
    <div
      data-slot="web-search-result"
      title={result.title}
      className={RESULT_ROW_CLASS}>
      {body}
    </div>
  )
}

function WebSearch({
  query,
  results,
  visibleResults,
  searching,
  cycle,
  className,
  ...props
}: WebSearchProps) {
  const labels = useAssistantLabels()
  const visible = results.slice(0, Math.max(0, Math.min(visibleResults, results.length)))
  const status = searching
    ? labels.webSearchSearching
    : visible.length > 0
      ? labels.webSearchCount(visible.length)
      : labels.webSearchEmpty

  return (
    <div
      data-slot="web-search"
      data-state={searching ? 'searching' : 'done'}
      className={cn('flex w-full max-w-sm flex-col gap-2.5', className)}
      {...props}>
      <span
        data-slot="web-search-query"
        className={cn(
          field,
          'text-foreground/70 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-3.5 py-2 text-xs'
        )}>
        <Icon
          icon="lucide:search"
          aria-hidden
          className="text-muted-foreground size-3 shrink-0"
        />
        <span className="min-w-0 truncate">{query}</span>
      </span>

      <div
        data-slot="web-search-status"
        className="text-muted-foreground text-xs">
        <span className={cn(searching && 'shimmer motion-reduce:animate-none')}>{status}</span>
      </div>

      <div
        data-slot="web-search-results"
        className="flex min-h-5 flex-col">
        {visible.map(function (result) {
          return (
            <WebSearchResultRow
              key={cycle + ':' + (result.href ?? result.domain) + ':' + result.title}
              result={result}
            />
          )
        })}
      </div>
    </div>
  )
}

export { WebSearch }
export type { WebSearchProps }
