import { useMemo } from 'react'

import { useSignboardStore, type SignboardColumn } from '@/stores/signboard'
import { BarChart } from '@/views/signboard/charts/charts'
import { ChartPanel } from '@/views/signboard/charts/panel'
import { findChartTheme } from '@/views/signboard/charts/theme'
import styles from '@/views/signboard/signboard.module.scss'

interface WorkloadViewProps {
  columns: SignboardColumn[]
}

function WorkloadView(props: WorkloadViewProps) {
  const entries = useSignboardStore(function (state) {
    return state.entries
  })

  const orderedColumns = useMemo(
    function () {
      return props.columns.slice().sort(function (a, b) {
        return a.index - b.index
      })
    },
    [props.columns]
  )

  const wipItems = useMemo(
    function () {
      const theme = findChartTheme()
      return orderedColumns.map(function (column) {
        const count = entries.filter(function (card) {
          return card.columnID === column.id && card.archivedAt === null
        }).length
        const limit = column.wipLimit
        const isOver = limit !== null && limit !== undefined && limit > 0 && count > limit
        const label =
          limit !== null && limit !== undefined
            ? `${column.title} (${count}/${limit})`
            : `${column.title} (${count})`
        return {
          name: label,
          value: count,
          fill: isOver ? theme.danger : theme.accent
        }
      })
    },
    [orderedColumns, entries]
  )

  const flowItems = useMemo(
    function () {
      return orderedColumns.map(function (column) {
        const count = entries.filter(function (card) {
          return card.columnID === column.id && card.archivedAt === null
        }).length
        return { name: column.title, value: count }
      })
    },
    [orderedColumns, entries]
  )

  const hasAnyRole = orderedColumns.some(function (column) {
    return column.role !== null && column.role !== undefined
  })

  const isEmpty = orderedColumns.length === 0
  const isWipEmpty =
    isEmpty ||
    wipItems.every(function (item) {
      return item.value === 0
    })

  return (
    <div className={styles.paneView}>
      <div className={styles.chartsGrid}>
        <ChartPanel
          title="WIP 占用"
          icon="lucide:gauge"
          hint="计数 vs 上限 · 超限标红">
          <BarChart
            items={wipItems}
            isEmpty={isWipEmpty}
            emptyHint={isEmpty ? '先添加列' : '暂无卡片'}
          />
        </ChartPanel>

        <ChartPanel
          title="列流量"
          icon="lucide:git-commit-horizontal"
          hint={hasAnyRole ? '按列顺序 · 已设语义' : '按列顺序'}>
          <BarChart
            items={flowItems}
            isEmpty={flowItems.every(function (item) {
              return item.value === 0
            })}
            emptyHint={isEmpty ? '先添加列' : '暂无卡片'}
          />
        </ChartPanel>
      </div>
    </div>
  )
}

export { WorkloadView }
