/**
 * 用量 section：本地 `agent_usage` 的会话账本（汇总 + 逐轮明细）。
 *
 * 数据来自本地库（PR5 起由 `acp/session.ts::recordUsage` 每轮写入，走标准 ACP
 * `PromptResponse.usage` 的累计值减基线），**不走 goose**，所以这一页不需要等 serve 就绪。
 * 有活跃会话时只看该会话，否则给全部会话的合计。
 */
import { useEffect } from 'react'

import { findUsageTotals, formatTokens } from '@/features/agent/model/usage'
import { useAgentStore } from '@/stores/agent'

type Usage = MagneticTile.Agent.Usage

function findTimeLabel(createdAt: number): string {
  return new Date(createdAt).toLocaleString('zh-CN', { hour12: false })
}

function UsageSection() {
  const activeSessionID = useAgentStore(function (state) {
    return state.activeSessionID
  })
  const usages = useAgentStore(function (state) {
    return state.usages
  })

  useEffect(
    function () {
      void useAgentStore
        .getState()
        .toReadUsages(activeSessionID ? { sessionID: activeSessionID } : undefined)
    },
    [activeSessionID]
  )

  const rows = [...usages].sort(function (left, right) {
    return right.createdAt - left.createdAt
  })
  const totals = findUsageTotals(rows)
  const scopeLabel = activeSessionID ? '当前会话' : '全部会话'

  const stats = [
    { label: '轮次', value: formatTokens(totals.runs) },
    { label: '输入 token', value: formatTokens(totals.inputTokens) },
    { label: '输出 token', value: formatTokens(totals.outputTokens) },
    { label: '合计 token', value: formatTokens(totals.totalTokens) }
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-8 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
        {stats.map(function (stat) {
          return (
            <div
              key={stat.label}
              className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{stat.label}</span>
              <span className="text-lg leading-none font-semibold tabular-nums">
                {stat.value}
              </span>
            </div>
          )
        })}
      </div>

      <span className="text-xs text-muted-foreground">
        {scopeLabel} · 每轮一次记录，来自 goose 返回的 token 用量
      </span>

      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          暂无用量
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-2 text-left font-medium">时间</th>
              <th className="py-2 text-left font-medium">模型</th>
              <th className="py-2 text-right font-medium">输入</th>
              <th className="py-2 text-right font-medium">输出</th>
              <th className="py-2 text-right font-medium">合计</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(function (row: Usage) {
              return (
                <tr
                  key={row.id}
                  className="border-t border-border/60">
                  <td className="py-2 text-muted-foreground">{findTimeLabel(row.createdAt)}</td>
                  <td className="py-2">{row.model}</td>
                  <td className="py-2 text-right tabular-nums">{formatTokens(row.inputTokens)}</td>
                  <td className="py-2 text-right tabular-nums">{formatTokens(row.outputTokens)}</td>
                  <td className="py-2 text-right tabular-nums">{formatTokens(row.totalTokens)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export { UsageSection }
