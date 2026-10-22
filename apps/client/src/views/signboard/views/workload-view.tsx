import { useMemo } from 'react'

import { useSignboardStore, type SignboardColumn } from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface WorkloadViewProps {
  columns: SignboardColumn[]
}

function WorkloadView(props: WorkloadViewProps) {
  const entries = useSignboardStore(function (state) {
    return state.entries
  })
  const entriesInColumn = useSignboardStore(function (state) {
    return state.entriesInColumn
  })

  const rows = useMemo(
    function () {
      return props.columns.map(function (column) {
        const count = entriesInColumn(column.id).length
        const limit = column.wipLimit
        const ratio = limit !== null && limit !== undefined && limit > 0 ? count / limit : null
        const isOver = ratio !== null && ratio !== undefined && ratio > 1
        return { column, count, limit, ratio, isOver }
      })
    },
    [props.columns, entries, entriesInColumn]
  )

  return (
    <div className={styles.paneView}>
      <div className={styles.workloadList}>
        {rows.map(function (row) {
          const pct =
            row.ratio !== null && row.ratio !== undefined
              ? Math.min(row.ratio * 100, 100)
              : Math.min(row.count * 12, 100)
          return (
            <section
              key={row.column.id}
              className={row.isOver ? styles.workloadCardOver : styles.workloadCard}>
              <div className={styles.workloadHeader}>
                <h3 className={styles.workloadTitle}>{row.column.title}</h3>
                <p className={styles.workloadCount}>
                  {row.count}
                  {row.limit !== null && row.limit !== undefined ? ` / ${row.limit}` : ''}
                  {row.isOver ? ' · 超限' : ''}
                </p>
              </div>
              <div className={styles.statsBarTrack}>
                <div
                  className={row.isOver ? styles.statsBarFillDanger : styles.statsBarFill}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className={styles.workloadHint}>
                {row.limit === null || row.limit === undefined
                  ? '未设置 WIP 上限，条长仅示意卡片数量'
                  : `WIP 上限 ${row.limit}，当前占用 ${Math.round((row.ratio ?? 0) * 100)}%`}
              </p>
            </section>
          )
        })}
        {rows.length === 0 ? <p className={styles.paneEmpty}>先添加列以查看工作量</p> : null}
      </div>
    </div>
  )
}

export { WorkloadView }
