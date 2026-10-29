/**
 * 待确认日程（plan 场景生成）：预览卡片读它，写入后清空。
 */
import { create } from 'zustand'

import type { ScheduleRow } from '@/features/agent/schedule-plan'

interface ScheduleDraftState {
  rows: ScheduleRow[]
  /** 上一次批量写入的 id（用于一次性撤销） */
  lastBatchIDs: string[]
  writeRows: (rows: ScheduleRow[]) => void
  updateRow: (key: string, patch: Partial<ScheduleRow>) => void
  removeRow: (key: string) => void
  clear: () => void
  rememberBatch: (ids: string[]) => void
  clearBatch: () => void
}

const useScheduleDraftStore = create<ScheduleDraftState>()(function (setter, getter) {
  return {
    rows: [],
    lastBatchIDs: [],

    writeRows(rows) {
      setter({ rows })
    },

    updateRow(key, patch) {
      setter({
        rows: getter().rows.map(function (row) {
          return row.key === key ? { ...row, ...patch } : row
        })
      })
    },

    removeRow(key) {
      setter({
        rows: getter().rows.filter(function (row) {
          return row.key !== key
        })
      })
    },

    clear() {
      setter({ rows: [] })
    },

    rememberBatch(ids) {
      setter({ lastBatchIDs: ids, rows: [] })
    },

    clearBatch() {
      setter({ lastBatchIDs: [] })
    }
  }
})

export { useScheduleDraftStore }
