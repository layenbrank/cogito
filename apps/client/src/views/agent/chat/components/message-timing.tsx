/**
 * 消息级耗时指标（过程区尾注里的第二行小字）。
 *
 * 只保留「确实能看出这轮跑得好不好」的三个数：首字延迟、输出速度、token 数。
 * 步数由 `thread.aui.tsx` 的尾注写（`已工作 4.8s · 6 步`），这里不重复。
 * 轨迹瀑布图早已下线 —— 同一批信息画成两层时间轴，既占地方又没人对着它看。
 * 见 docs/apps/client/assistant-ui-elements.md「过程区」。
 *
 * `timing` 只在回合结算后才有（assistant-ui 的 `stepStreamingTiming` 在
 * `isRunning -> false` 才 finalize），所以运行中这一行不出现，也不需要自己造时钟。
 */
import { useMessageTiming } from '@assistant-ui/react'
import { memo } from 'react'

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const MessageTimingStats = memo(function MessageTimingStats() {
  const timing = useMessageTiming()
  if (!timing) return null

  const ttftMs =
    timing.firstTokenTime === undefined
      ? undefined
      : Math.max(0, timing.firstTokenTime - timing.streamStartTime)

  const stats: { label: string; value: string }[] = []
  if (ttftMs !== undefined) stats.push({ label: '首字', value: formatMs(ttftMs) })
  if (timing.tokensPerSecond !== undefined)
    stats.push({ label: '速度', value: `${timing.tokensPerSecond} tok/s` })
  if (timing.tokenCount !== undefined)
    stats.push({ label: 'Token', value: String(timing.tokenCount) })

  if (stats.length === 0) return null
  return (
    <div
      data-slot="message-timing-stats"
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {stats.map(function (stat) {
        return (
          <span
            key={stat.label}
            className="text-muted-foreground flex items-baseline gap-1">
            {stat.label}
            <span className="text-foreground font-mono tabular-nums">{stat.value}</span>
          </span>
        )
      })}
    </div>
  )
})

export { MessageTimingStats }
