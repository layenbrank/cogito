/**
 * Retrieval chunks（对齐 assistant-ui `elements/retrieval-chunks`）
 *
 * 一次检索命中的**段落**：查询药丸 + 状态行 + 每条命中一张小纸卡。
 * 纸卡三行：来源（标题）+ 定位串 + 分数，片段两行截断，底下一条 2px 的相关度条。
 * 分数 ≥ 0.8 走 success 色，其余弱色 —— 一眼能看出「哪条最该读」。
 *
 * 与 `web-search` 的分工：
 * - web-search 是**外部来源**（站 + 标题 + 域名），点开去浏览器；
 * - 本元素是**库内段落**（文档 + 定位 + 片段），留在这里读，所以给正文与分数条。
 *
 * 元素本体是收费产物，结构与无障碍按官网 DOM / `.md` 契约自写：
 * `role="meter"` 的 aria 读数与行里印的分数同源（`aria-valuetext` = `0.91 of 1.00`），
 * `visibleCount` 钳在 `0…chunks.length`，状态行在跑完时才读条数。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import { field, mono, paper, rowEnter } from './elements/surfaces'
import { useAssistantLabels } from './labels'
import { formatScore, toPercent, type RetrievalChunk } from './retrieval-chunks-state'

interface RetrievalChunksProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  /** 检索词：常显在药丸里 */
  query: string
  /** 全量命中；只渲染前 `visibleCount` 条 */
  chunks: readonly RetrievalChunk[]
  /** 逐条落进来的进度（钳在 0…chunks.length） */
  visibleCount: number
  /** 检索中：状态行换成 shimmer 文案 */
  searching: boolean
}

/** 分数条 + 分数文本；模糊匹配回退没有可信分数，只给一个弱色标记 */
function RetrievalChunkScore(props: { chunk: RetrievalChunk }) {
  const labels = useAssistantLabels()
  const chunk = props.chunk
  if (chunk.fuzzy) {
    return (
      <span
        data-slot="retrieval-chunk-fuzzy"
        title={labels.retrievalFuzzyHint}
        className={cn(mono, 'shrink-0')}>
        {labels.retrievalFuzzy}
      </span>
    )
  }
  const score = formatScore(chunk.score)
  return (
    <span
      data-slot="retrieval-chunk-score"
      className={cn(
        mono,
        'shrink-0 tabular-nums',
        chunk.score >= 0.8 ? 'text-success' : 'text-muted-foreground'
      )}>
      {score}
    </span>
  )
}

function RetrievalChunkCard(props: { chunk: RetrievalChunk }) {
  const labels = useAssistantLabels()
  const chunk = props.chunk
  const percent = toPercent(chunk.score)

  return (
    <article
      data-slot="retrieval-chunk"
      className={cn(paper, rowEnter, 'flex flex-col gap-1.5 rounded-2xl px-3.5 py-2.5')}>
      <div className="flex items-baseline gap-2">
        <span
          data-slot="retrieval-chunk-source"
          title={chunk.source}
          className="text-foreground/90 min-w-0 flex-1 truncate text-sm font-medium">
          {chunk.source}
        </span>
        {chunk.locator ? (
          <span
            data-slot="retrieval-chunk-locator"
            title={chunk.locator}
            className={cn(mono, 'shrink-0')}>
            {chunk.locator}
          </span>
        ) : null}
        <RetrievalChunkScore chunk={chunk} />
      </div>

      {chunk.text ? (
        <p
          data-slot="retrieval-chunk-text"
          className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
          {chunk.text}
        </p>
      ) : null}

      {chunk.fuzzy ? null : (
        <span
          data-slot="retrieval-chunk-meter"
          role="meter"
          aria-label={labels.retrievalMeter(chunk.source)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={formatScore(chunk.score) + ' of 1.00'}
          className="bg-foreground/[0.06] inset-ring-border inset-ring h-[2px] w-full overflow-hidden rounded-full forced-colors:outline">
          <span
            aria-hidden
            className="bg-primary/60 block h-full rounded-full transition-[width] duration-500 forced-color-adjust-none motion-reduce:transition-none"
            style={{ width: percent + '%' }}
          />
        </span>
      )}
    </article>
  )
}

function RetrievalChunks({
  query,
  chunks,
  visibleCount,
  searching,
  className,
  ...props
}: RetrievalChunksProps) {
  const labels = useAssistantLabels()
  const visible = chunks.slice(0, Math.max(0, Math.min(visibleCount, chunks.length)))
  const status = searching
    ? labels.retrievalRetrieving
    : chunks.length > 0
      ? labels.retrievalMatches(chunks.length)
      : labels.retrievalEmpty

  return (
    <div
      data-slot="retrieval-chunks"
      data-state={searching ? 'searching' : 'done'}
      className={cn('flex w-full max-w-sm flex-col gap-2.5', className)}
      {...props}>
      <span
        data-slot="retrieval-chunks-query"
        className={cn(
          field,
          'text-foreground/70 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-3.5 py-2 text-xs'
        )}>
        <Icon
          icon="lucide:database"
          aria-hidden
          className="text-muted-foreground size-3 shrink-0"
        />
        <span className="min-w-0 truncate">{query}</span>
      </span>

      <div
        data-slot="retrieval-chunks-status"
        className="text-muted-foreground text-xs">
        <span className={cn(searching && 'shimmer motion-reduce:animate-none')}>{status}</span>
      </div>

      <div
        data-slot="retrieval-chunks-list"
        className="flex flex-col gap-1.5">
        {visible.map(function (chunk) {
          return (
            <RetrievalChunkCard
              key={chunk.id}
              chunk={chunk}
            />
          )
        })}
      </div>
    </div>
  )
}

export { RetrievalChunks }
export type { RetrievalChunksProps }
